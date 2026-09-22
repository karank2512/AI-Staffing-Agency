import { notFound, redirect } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GENERIC_ACTION_ERROR, runAction } from "@/lib/action-result";
import { AppError, conflict } from "@/server/errors";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runAction", () => {
  it("wraps the resolved value", async () => {
    expect(await runAction(async () => ({ redirectTo: "/workers/w1" }))).toEqual({
      ok: true,
      data: { redirectTo: "/workers/w1" },
    });
  });

  it("supports void actions", async () => {
    expect(await runAction(async () => undefined)).toEqual({ ok: true, data: undefined });
  });

  it("maps AppError to its user-facing message", async () => {
    const result = await runAction(async () => {
      throw conflict("This request is no longer awaiting a decision");
    });
    expect(result).toEqual({ ok: false, error: "This request is no longer awaiting a decision" });

    const notFoundResult = await runAction(async () => {
      throw new AppError("NOT_FOUND", "Worker not found");
    });
    expect(notFoundResult).toEqual({ ok: false, error: "Worker not found" });
  });

  it("turns Zod failures into one readable sentence", async () => {
    const schema = z.object({ name: z.string().min(3, "Name must be at least 3 characters") });
    const result = await runAction(async () => schema.parse({ name: "a" }));
    expect(result).toEqual({ ok: false, error: "name: Name must be at least 3 characters" });
  });

  it("hides unknown errors behind a generic message with a support reference, and logs them", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await runAction(async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
    });
    // Internals never reach the client: one generic sentence plus a ref that appears in the log line.
    expect(result).toMatchObject({ ok: false });
    expect(result).toHaveProperty("error", expect.stringContaining(GENERIC_ACTION_ERROR));
    expect(result).toHaveProperty("error", expect.stringMatching(/\(ref [0-9a-f]{6}\)$/));
    expect(log).toHaveBeenCalledOnce();
  });

  it("rethrows Next.js control-flow signals so redirect() and notFound() keep working", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(runAction(async () => redirect("/sign-in"))).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    await expect(runAction(async () => notFound())).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_HTTP_ERROR_FALLBACK;404"),
    });
    expect(log).not.toHaveBeenCalled();
  });
});
