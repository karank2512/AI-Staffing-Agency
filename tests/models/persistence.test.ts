import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { db } from "@/server/db";
import { llm } from "@/server/models";
import { MAX_TRACE_MESSAGES, TRUNCATION_MARKER, buildRequestTrace, buildResponseTrace, clipDeep } from "@/server/models/persist";
import type { ChatMessage } from "@/server/models/types";
import { createTestOrg } from "../helpers/factory";
import { createHiredWorker } from "../helpers/fixtures";
import { searchTool } from "./helpers";

describe("models: trace truncation (pure)", () => {
  it("exposes the trace builders on the module index (the seed writes ModelCall rows with them)", async () => {
    const models = await import("@/server/models");
    expect(models.buildRequestTrace).toBe(buildRequestTrace);
    expect(models.buildResponseTrace).toBe(buildResponseTrace);
  });

  it("clips individual string fields to 2,000 chars and never slices serialized JSON", () => {
    const long = "a".repeat(2_500);
    const clipped = clipDeep({ text: long, nested: { list: [long, "short"], n: 42, flag: true, nothing: null } }) as {
      text: string;
      nested: { list: string[]; n: number; flag: boolean; nothing: null };
    };
    expect(clipped.text).toBe(`${"a".repeat(2_000)}${TRUNCATION_MARKER}`);
    expect(clipped.nested.list[0]).toHaveLength(2_000 + TRUNCATION_MARKER.length);
    expect(clipped.nested).toMatchObject({ n: 42, flag: true, nothing: null });
    expect(clipped.nested.list[1]).toBe("short");
    expect(() => JSON.parse(JSON.stringify(clipped))).not.toThrow();
  });

  it("keeps only the last 12 messages of a conversation", () => {
    const messages: ChatMessage[] = Array.from({ length: 20 }, (_, i) => ({ role: "user", content: `message ${i}` }));
    const trace = buildRequestTrace({ system: "sys", messages, tools: ["web_search"] });
    expect(trace.messages).toHaveLength(MAX_TRACE_MESSAGES);
    expect(trace.messages?.[0]).toEqual({ role: "user", content: "message 8" });
    expect(trace.messages?.at(-1)).toEqual({ role: "user", content: "message 19" });
    expect(trace.omittedMessages).toBe(8);
    expect(trace.tools).toEqual(["web_search"]);
    expect(messages).toHaveLength(20); // input untouched
  });

  it("builds minimal request/response shapes", () => {
    expect(buildRequestTrace({ prompt: "p", schemaName: "Thing" })).toEqual({ prompt: "p", schemaName: "Thing" });
    expect(buildRequestTrace({ messages: [], tools: [] })).toEqual({ messages: [] });
    expect(buildResponseTrace({ text: "hi", toolCalls: [], finishReason: "stop" })).toEqual({ text: "hi", finishReason: "stop" });
    expect(buildResponseTrace({ object: { a: "b".repeat(3_000) } })).toEqual({
      object: { a: `${"b".repeat(2_000)}${TRUNCATION_MARKER}` },
    });
  });
});

describe("models: persistence (ModelCall + usage)", () => {
  let org: Awaited<ReturnType<typeof createTestOrg>>;
  let hired: Awaited<ReturnType<typeof createHiredWorker>>;

  beforeAll(async () => {
    org = await createTestOrg("models");
    hired = await createHiredWorker(org.organization.id, { userId: org.user.id });
  });

  afterAll(async () => {
    await org.cleanup();
  });

  afterEach(() => vi.restoreAllMocks());

  async function createRun() {
    return db.run.create({
      data: {
        organizationId: org.organization.id,
        jobId: hired.job.id,
        workerId: hired.worker.id,
        workerVersionId: hired.version.id,
        status: "RUNNING",
        simulated: true,
      },
    });
  }

  it("generateText creates a ModelCall + UsageRecord and increments the Run rollups", async () => {
    const run = await createRun();
    const step = await db.runStep.create({
      data: { runId: run.id, index: 0, kind: "MODEL_CALL", title: "Alex is thinking about the next step" },
    });
    const tracking = {
      organizationId: org.organization.id,
      purpose: "agent.turn",
      workerId: hired.worker.id,
      jobId: hired.job.id,
      runId: run.id,
      runStepId: step.id,
    };
    const messages: ChatMessage[] = [{ role: "user", content: "Find funded AI infrastructure startups. ".repeat(10) }];

    const first = await llm.generateText(
      {
        tier: "standard",
        system: "You are Alex, a market researcher.",
        messages,
        tools: [searchTool],
        mock: () => ({ text: "", toolCalls: [{ name: "web_search", input: { query: "ai infra funding" } }] }),
      },
      tracking,
    );
    expect(first.modelCallId).toBeTruthy();
    expect(first.simulated).toBe(true);
    expect(first.costUsd).toBeGreaterThan(0);

    const call = await db.modelCall.findFirstOrThrow({ where: { id: first.modelCallId, organizationId: org.organization.id } });
    expect(call).toMatchObject({
      purpose: "agent.turn",
      provider: "mock",
      model: "mock-standard",
      tier: "standard",
      simulated: true,
      workerId: hired.worker.id,
      jobId: hired.job.id,
      runId: run.id,
      runStepId: step.id,
      inputTokens: first.usage.inputTokens,
      outputTokens: first.usage.outputTokens,
      error: null,
    });
    expect(Number(call.costUsd)).toBeCloseTo(first.costUsd, 6);
    expect(call.request).toEqual({ system: "You are Alex, a market researcher.", messages, tools: ["web_search"] });
    expect(call.response).toEqual({
      toolCalls: [{ id: "mock_0_0", name: "web_search", input: { query: "ai infra funding" } }],
      text: "",
      finishReason: "tool_calls",
    });

    const second = await llm.generateText(
      { tier: "standard", messages, mock: () => ({ text: "All done — 12 rounds found." }) },
      tracking,
    );

    const usage = await db.usageRecord.findMany({ where: { organizationId: org.organization.id, runId: run.id } });
    expect(usage).toHaveLength(2);
    for (const record of usage) {
      expect(record).toMatchObject({ kind: "MODEL", provider: "mock", resource: "mock-standard", simulated: true, workerId: hired.worker.id });
      expect(Number(record.billableUsd)).toBeGreaterThanOrEqual(Number(record.costUsd));
    }

    const rolledUp = await db.run.findUniqueOrThrow({ where: { id: run.id } });
    expect(rolledUp.inputTokens).toBe(first.usage.inputTokens + second.usage.inputTokens);
    expect(rolledUp.outputTokens).toBe(first.usage.outputTokens + second.usage.outputTokens);
    expect(Number(rolledUp.costUsd)).toBeCloseTo(first.costUsd + second.costUsd, 6);
  });

  it("generateObject persists the object trace without a run", async () => {
    const schema = z.object({ summary: z.string(), score: z.number() });
    const result = await llm.generateObject(
      {
        tier: "fast",
        system: "You grade deliverables.",
        prompt: "Grade this report",
        schema,
        schemaName: "Judge",
        mock: () => ({ summary: "Solid work", score: 0.9 }),
      },
      { organizationId: org.organization.id, purpose: "evaluation.judge", workerId: hired.worker.id },
    );

    const call = await db.modelCall.findFirstOrThrow({ where: { id: result.modelCallId, organizationId: org.organization.id } });
    expect(call).toMatchObject({ purpose: "evaluation.judge", model: "mock-fast", tier: "fast", runId: null, runStepId: null });
    expect(call.request).toEqual({ system: "You grade deliverables.", prompt: "Grade this report", schemaName: "Judge" });
    expect(call.response).toEqual({ object: { summary: "Solid work", score: 0.9 } });

    const usage = await db.usageRecord.findMany({
      where: { organizationId: org.organization.id, runId: null, resource: "mock-fast", workerId: hired.worker.id },
    });
    expect(usage).toHaveLength(1);
    expect(usage[0].inputTokens).toBe(result.usage.inputTokens);
  });

  it("stores a truncated trace for oversized conversations", async () => {
    const messages: ChatMessage[] = Array.from({ length: 15 }, (_, i) => ({ role: "user", content: `${i}:` + "z".repeat(3_000) }));
    const result = await llm.generateText(
      { tier: "fast", messages, mock: () => ({ text: "ok" }) },
      { organizationId: org.organization.id, purpose: "chat.reply" },
    );
    const call = await db.modelCall.findFirstOrThrow({ where: { id: result.modelCallId, organizationId: org.organization.id } });
    const request = call.request as { messages: Array<{ content: string }>; omittedMessages: number };
    expect(request.messages).toHaveLength(12);
    expect(request.omittedMessages).toBe(3);
    expect(request.messages[0].content.startsWith("3:")).toBe(true);
    expect(request.messages.every((m) => m.content.endsWith(TRUNCATION_MARKER))).toBe(true);
  });

  it("persist: false writes nothing", async () => {
    const purpose = `test.dry-run.${Date.now()}`;
    const result = await llm.generateText(
      { tier: "fast", messages: [{ role: "user", content: "hi" }], mock: () => ({ text: "hello" }) },
      { organizationId: org.organization.id, purpose, persist: false },
    );
    expect(result.modelCallId).toBeUndefined();
    expect(await db.modelCall.count({ where: { organizationId: org.organization.id, purpose } })).toBe(0);
  });

  it("records a failed call with its error and never meters it", async () => {
    const purpose = `test.failure.${Date.now()}`;
    const failing = llm.generateObject(
      {
        tier: "standard",
        prompt: "p",
        schema: z.object({ n: z.number() }),
        schemaName: "Broken",
        mock: () => ({ n: "not a number" }) as unknown as { n: number },
      },
      { organizationId: org.organization.id, purpose },
    );
    await expect(failing).rejects.toMatchObject({ code: "INTERNAL" });

    const calls = await db.modelCall.findMany({ where: { organizationId: org.organization.id, purpose } });
    expect(calls).toHaveLength(1);
    expect(calls[0].error).toContain("Broken");
    expect(calls[0].inputTokens).toBe(0);
    expect(Number(calls[0].costUsd)).toBe(0);
  });

  it("never throws when persistence fails — the model result is still returned", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await llm.generateText(
      { tier: "fast", messages: [{ role: "user", content: "hi" }], mock: () => ({ text: "still fine" }) },
      { organizationId: "org_that_does_not_exist", purpose: "test.persist-failure" },
    );
    expect(result.text).toBe("still fine");
    expect(result.modelCallId).toBeUndefined();
    expect(error).toHaveBeenCalled();
  });
});
