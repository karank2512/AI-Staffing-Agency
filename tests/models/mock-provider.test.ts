import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError } from "@/server/errors";
import { llm } from "@/server/models";
import type { ChatMessage, MockTextResponse } from "@/server/models/types";
import { DRY_RUN, fetchTool, searchTool } from "./helpers";

const user = (content: string): ChatMessage => ({ role: "user", content });

describe("models: mock generateText", () => {
  it("hands the mock the same conversation the model would see", async () => {
    const mock = vi.fn((): MockTextResponse => ({ text: "done" }));
    const messages = [user("Find funded startups")];
    await llm.generateText({ tier: "standard", system: "You are Alex.", messages, tools: [searchTool], mock }, DRY_RUN);
    expect(mock).toHaveBeenCalledWith({ system: "You are Alex.", messages, tools: [searchTool] });
  });

  it("defaults `tools` to an empty list for the mock", async () => {
    const mock = vi.fn((): MockTextResponse => ({ text: "done" }));
    await llm.generateText({ tier: "fast", messages: [user("hi")], mock }, DRY_RUN);
    expect(mock.mock.calls[0]).toEqual([{ system: undefined, messages: [user("hi")], tools: [] }]);
  });

  it("issues deterministic tool-call ids: mock_<assistantTurnIndex>_<i>", async () => {
    const mock = (): MockTextResponse => ({
      text: "",
      toolCalls: [
        { name: "web_search", input: { query: "ai infra funding" } },
        { name: "fetch_url", input: { url: "https://news.example/a" } },
      ],
    });
    const tools = [searchTool, fetchTool];

    const first = await llm.generateText({ tier: "standard", messages: [user("go")], tools, mock }, DRY_RUN);
    expect(first.toolCalls).toEqual([
      { id: "mock_0_0", name: "web_search", input: { query: "ai infra funding" } },
      { id: "mock_0_1", name: "fetch_url", input: { url: "https://news.example/a" } },
    ]);
    expect(first.finishReason).toBe("tool_calls");

    // Same conversation → same ids (resuming a run must reproduce them).
    const again = await llm.generateText({ tier: "standard", messages: [user("go")], tools, mock }, DRY_RUN);
    expect(again.toolCalls).toEqual(first.toolCalls);

    // One assistant turn already in the conversation → turn index 1.
    const conversation: ChatMessage[] = [
      user("go"),
      { role: "assistant", content: "", toolCalls: first.toolCalls },
      { role: "tool", toolCallId: "mock_0_0", toolName: "web_search", output: { results: [] } },
      { role: "tool", toolCallId: "mock_0_1", toolName: "fetch_url", output: { error: "timeout" }, isError: true },
    ];
    const second = await llm.generateText({ tier: "standard", messages: conversation, tools, mock }, DRY_RUN);
    expect(second.toolCalls.map((c) => c.id)).toEqual(["mock_1_0", "mock_1_1"]);
  });

  it("drops tool calls for tools that were not offered", async () => {
    const mock = (): MockTextResponse => ({
      text: "",
      toolCalls: [
        { name: "send_notification", input: { channel: "email" } },
        { name: "web_search", input: { query: "x" } },
      ],
    });
    const result = await llm.generateText({ tier: "fast", messages: [user("go")], tools: [searchTool], mock }, DRY_RUN);
    expect(result.toolCalls).toEqual([{ id: "mock_0_0", name: "web_search", input: { query: "x" } }]);
    expect(result.finishReason).toBe("tool_calls");

    const none = await llm.generateText({ tier: "fast", messages: [user("go")], mock }, DRY_RUN);
    expect(none.toolCalls).toEqual([]);
    expect(none.finishReason).toBe("stop");
  });

  it("finishes with 'stop' on a plain answer and reports simulated call metadata", async () => {
    const text = "x".repeat(400);
    const messages = [user("Summarize the findings")];
    const system = "You are an analyst.";
    const result = await llm.generateText({ tier: "standard", system, messages, mock: () => ({ text }) }, DRY_RUN);

    expect(result.text).toBe(text);
    expect(result.finishReason).toBe("stop");
    expect(result).toMatchObject({ provider: "mock", model: "mock-standard", tier: "standard", simulated: true });
    expect(result.modelCallId).toBeUndefined();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);

    // ~4 chars per token over system + messages JSON (input) and the produced text (output).
    expect(result.usage.inputTokens).toBe(Math.ceil((system.length + JSON.stringify(messages).length) / 4));
    expect(result.usage.outputTokens).toBe(100);
    // Priced at the standard tier's reference model (claude-sonnet-5: $2 / $10 per MTok).
    const expected = (result.usage.inputTokens * 2 + result.usage.outputTokens * 10) / 1_000_000;
    expect(result.costUsd).toBeCloseTo(expected, 6);
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it("supports async mocks and surfaces a crashing mock as INTERNAL (never as a model error)", async () => {
    const ok = await llm.generateText({ tier: "fast", messages: [user("hi")], mock: async () => ({ text: "hello" }) }, DRY_RUN);
    expect(ok.text).toBe("hello");

    const crash = llm.generateText(
      {
        tier: "fast",
        messages: [user("hi")],
        mock: () => {
          throw new Error("boom");
        },
      },
      DRY_RUN,
    );
    await expect(crash).rejects.toMatchObject({ name: "AppError", code: "INTERNAL" });
  });
});

describe("models: mock generateObject", () => {
  const QuestionsSchema = z.object({
    questions: z.array(z.object({ id: z.string(), question: z.string() })).max(3),
    confidence: z.number().min(0).max(1),
  });

  it("applies normalize BEFORE validation", async () => {
    const result = await llm.generateObject(
      {
        tier: "fast",
        prompt: "Ask follow-up questions",
        schema: QuestionsSchema,
        schemaName: "ScopingQuestions",
        normalize: (raw) => {
          const value = raw as { questions: unknown[]; confidence: number };
          return { ...value, questions: value.questions.slice(0, 3), confidence: Math.min(1, value.confidence) };
        },
        mock: () => ({
          questions: [1, 2, 3, 4, 5].map((n) => ({ id: `q${n}`, question: `Question ${n}?` })),
          confidence: 1.7,
        }),
      },
      DRY_RUN,
    );
    expect(result.object.questions.map((q) => q.id)).toEqual(["q1", "q2", "q3"]);
    expect(result.object.confidence).toBe(1);
    expect(result).toMatchObject({ provider: "mock", model: "mock-fast", tier: "fast", simulated: true });
    expect(result.usage.inputTokens).toBe(Math.ceil("Ask follow-up questions".length / 4));
    expect(result.usage.outputTokens).toBe(Math.ceil(JSON.stringify(result.object).length / 4));
  });

  it("returns the PARSED object (schema defaults applied)", async () => {
    const schema = z.object({ title: z.string(), tags: z.array(z.string()).default([]) });
    const result = await llm.generateObject(
      { tier: "standard", prompt: "p", schema, schemaName: "Thing", mock: () => ({ title: "Hello" }) as z.infer<typeof schema> },
      DRY_RUN,
    );
    expect(result.object).toEqual({ title: "Hello", tags: [] });
  });

  it("throws AppError INTERNAL with the Zod issues when the mock fails its own schema", async () => {
    const call = llm.generateObject(
      {
        tier: "standard",
        prompt: "Ask follow-up questions",
        schema: QuestionsSchema,
        schemaName: "ScopingQuestions",
        mock: () => ({ questions: [{ id: "q1" }], confidence: 2 }) as unknown as z.infer<typeof QuestionsSchema>,
      },
      DRY_RUN,
    );
    const error = await call.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AppError);
    const appError = error as AppError;
    expect(appError.code).toBe("INTERNAL");
    expect(appError.message).toContain("ScopingQuestions");
    expect(appError.message).toContain("questions.0.question");
    const details = appError.details as { issues: Array<{ path: PropertyKey[] }> };
    expect(details.issues.map((i) => i.path.join("."))).toEqual(expect.arrayContaining(["questions.0.question", "confidence"]));
  });
});
