import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError } from "@/server/errors";
import {
  buildReaskPrompt,
  extractJsonText,
  generateObjectWithReask,
  repairJsonText,
  stripNulls,
  validateObject,
  type ObjectAttempt,
} from "@/server/models/repair";
import { isTransientError, withTransientRetry } from "@/server/models/retry";

const Schema = z.object({ title: z.string(), note: z.string().optional(), tags: z.array(z.string()).max(2) });
type Thing = z.infer<typeof Schema>;

describe("models: structured-output repair", () => {
  it("stripNulls removes null-valued properties recursively but keeps array positions", () => {
    expect(stripNulls({ a: null, b: { c: null, d: 1 }, e: [{ f: null, g: "x" }, null, 2] })).toEqual({
      b: { d: 1 },
      e: [{ g: "x" }, null, 2],
    });
    expect(stripNulls(null)).toBeNull();
    expect(stripNulls("text")).toBe("text");
  });

  it("extractJsonText handles fences and surrounding prose", () => {
    expect(extractJsonText('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJsonText('Here you go: [1, 2, 3] — enjoy')).toBe("[1, 2, 3]");
    expect(extractJsonText("no json here")).toBeNull();
    expect(extractJsonText("")).toBeNull();
  });

  it("repairJsonText parses, strips nulls and re-serializes", async () => {
    expect(await repairJsonText({ text: '{"title":"T","note":null,"tags":[]}' })).toBe('{"title":"T","tags":[]}');
    expect(await repairJsonText({ text: 'Sure!\n```json\n{"title":"T","tags":[]}\n```' })).toBe('{"title":"T","tags":[]}');
    // Nothing to repair / unrepairable → null, so the SDK surfaces the original error.
    expect(await repairJsonText({ text: '{"title":"T","tags":[]}' })).toBeNull();
    expect(await repairJsonText({ text: '{"title": "T", ' })).toBeNull();
  });

  it("validateObject runs normalize before the schema and reports readable issues", () => {
    const normalize = (raw: unknown) => {
      const value = raw as Thing;
      return { ...value, tags: value.tags.slice(0, 2) };
    };
    expect(validateObject({ title: "T", tags: ["a", "b", "c"] }, { schema: Schema, normalize })).toEqual({
      ok: true,
      object: { title: "T", tags: ["a", "b"] },
    });

    const invalid = validateObject({ title: 7, tags: [] }, { schema: Schema });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.issues).toMatch(/^- title: /);

    // A normalizer that trips over an unexpected shape is a validation failure, not a crash.
    const crashed = validateObject("just a string", { schema: Schema, normalize });
    expect(crashed.ok).toBe(false);
  });

  it("re-asks exactly once with the issues appended, and sums usage", async () => {
    const attempt = vi
      .fn<(prompt: string) => Promise<ObjectAttempt<Thing>>>()
      .mockResolvedValueOnce({ ok: false, issues: "- title: expected string", text: '{"title":7}', usage: { inputTokens: 100, outputTokens: 10 } })
      .mockResolvedValueOnce({ ok: true, object: { title: "T", tags: [] }, usage: { inputTokens: 150, outputTokens: 12 } });

    const result = await generateObjectWithReask({ prompt: "Describe the thing", schemaName: "Thing" }, attempt);
    expect(result).toEqual({ object: { title: "T", tags: [] }, usage: { inputTokens: 250, outputTokens: 22 } });
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(attempt.mock.calls[0][0]).toBe("Describe the thing");
    const reask = attempt.mock.calls[1][0];
    expect(reask.startsWith("Describe the thing")).toBe(true);
    expect(reask).toContain("- title: expected string");
    expect(reask).toContain('{"title":7}');
  });

  it("does not re-ask after a valid first attempt", async () => {
    const attempt = vi.fn(async (): Promise<ObjectAttempt<Thing>> => ({
      ok: true,
      object: { title: "T", tags: [] },
      usage: { inputTokens: 1, outputTokens: 1 },
    }));
    await generateObjectWithReask({ prompt: "p", schemaName: "Thing" }, attempt);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("throws MODEL_ERROR (carrying the consumed usage) when the correction is invalid too", async () => {
    const failed: ObjectAttempt<Thing> = { ok: false, issues: "- tags: too big", usage: { inputTokens: 40, outputTokens: 5 } };
    const attempt = vi.fn(async () => failed);
    const error = await generateObjectWithReask({ prompt: "p", schemaName: "Thing" }, attempt).then(
      () => null,
      (e: unknown) => e,
    );
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("MODEL_ERROR");
    expect((error as AppError).details).toMatchObject({ usage: { inputTokens: 80, outputTokens: 10 }, issues: "- tags: too big" });
  });

  it("buildReaskPrompt bounds the echoed output", () => {
    const prompt = buildReaskPrompt("P", { issues: "- x: bad", text: "y".repeat(10_000) });
    expect(prompt.length).toBeLessThan(5_000);
  });
});

describe("models: transient retry policy", () => {
  const apiError = (statusCode: number) => Object.assign(new Error(`HTTP ${statusCode}`), { statusCode });
  const noSleep = async () => {};

  it("classifies 429 / 5xx / timeouts / network failures as transient", () => {
    expect(isTransientError(apiError(429))).toBe(true);
    expect(isTransientError(apiError(503))).toBe(true);
    expect(isTransientError(apiError(400))).toBe(false);
    expect(isTransientError(apiError(401))).toBe(false);
    expect(isTransientError(Object.assign(new Error("x"), { isRetryable: true }))).toBe(true);
    expect(isTransientError(Object.assign(new Error("timed out"), { name: "TimeoutError" }))).toBe(true);
    expect(isTransientError(new TypeError("fetch failed", { cause: Object.assign(new Error("reset"), { code: "ECONNRESET" }) }))).toBe(true);
    expect(isTransientError(new Error("schema mismatch"))).toBe(false);
    expect(isTransientError(undefined)).toBe(false);
  });

  it("retries transient failures at most twice, with backoff", async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => void sleeps.push(ms);

    const flaky = vi.fn<() => Promise<string>>().mockRejectedValueOnce(apiError(429)).mockRejectedValueOnce(apiError(500)).mockResolvedValue("ok");
    expect(await withTransientRetry(flaky, { sleep, baseDelayMs: 100 })).toBe("ok");
    expect(flaky).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([100, 200]);

    const down = vi.fn<() => Promise<string>>().mockRejectedValue(apiError(503));
    await expect(withTransientRetry(down, { sleep: noSleep })).rejects.toThrow("HTTP 503");
    expect(down).toHaveBeenCalledTimes(3);
  });

  it("does not retry permanent failures and honors retry-after", async () => {
    const bad = vi.fn<() => Promise<string>>().mockRejectedValue(apiError(400));
    await expect(withTransientRetry(bad, { sleep: noSleep })).rejects.toThrow("HTTP 400");
    expect(bad).toHaveBeenCalledTimes(1);

    const sleeps: number[] = [];
    const limited = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(Object.assign(apiError(429), { responseHeaders: { "retry-after": "2" } }))
      .mockResolvedValue("ok");
    await withTransientRetry(limited, { sleep: async (ms) => void sleeps.push(ms) });
    expect(sleeps).toEqual([2000]);
  });
});
