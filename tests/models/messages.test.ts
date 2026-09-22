import { describe, expect, it } from "vitest";
import { fromModelMessages, toJsonValue, toModelMessages } from "@/server/models/messages";
import type { ChatMessage } from "@/server/models/types";

const conversation: ChatMessage[] = [
  { role: "user", content: "Find recently funded AI infrastructure startups." },
  {
    role: "assistant",
    content: "I'll start with a search.",
    toolCalls: [
      { id: "call_1", name: "web_search", input: { query: "ai infrastructure funding" } },
      { id: "call_2", name: "fetch_url", input: { url: "https://news.example/rounds" } },
    ],
  },
  { role: "tool", toolCallId: "call_1", toolName: "web_search", output: { results: [{ title: "Round A", url: "https://a.example" }] } },
  { role: "tool", toolCallId: "call_2", toolName: "fetch_url", output: { error: "Request timed out" }, isError: true },
  { role: "assistant", content: '[{"company":"Acme"}]' },
];

describe("models: ChatMessage ↔ ModelMessage conversion", () => {
  it("maps assistant tool calls to tool-call parts", () => {
    const [userMessage, assistant] = toModelMessages(conversation);
    expect(userMessage).toEqual({ role: "user", content: "Find recently funded AI infrastructure startups." });
    expect(assistant).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "I'll start with a search." },
        { type: "tool-call", toolCallId: "call_1", toolName: "web_search", input: { query: "ai infrastructure funding" } },
        { type: "tool-call", toolCallId: "call_2", toolName: "fetch_url", input: { url: "https://news.example/rounds" } },
      ],
    });
  });

  it("merges consecutive tool messages into ONE tool message; errors become error-json", () => {
    const converted = toModelMessages(conversation);
    expect(converted).toHaveLength(4);
    expect(converted[2]).toEqual({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call_1",
          toolName: "web_search",
          output: { type: "json", value: { results: [{ title: "Round A", url: "https://a.example" }] } },
        },
        {
          type: "tool-result",
          toolCallId: "call_2",
          toolName: "fetch_url",
          output: { type: "error-json", value: { error: "Request timed out" } },
        },
      ],
    });
    expect(converted[3]).toEqual({ role: "assistant", content: '[{"company":"Acme"}]' });
  });

  it("omits the empty text part of a tool-calling turn (providers reject empty text blocks)", () => {
    const [assistant] = toModelMessages([
      { role: "assistant", content: "", toolCalls: [{ id: "mock_0_0", name: "calculator", input: { expression: "1+1" } }] },
    ]);
    expect(assistant).toEqual({
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "mock_0_0", toolName: "calculator", input: { expression: "1+1" } }],
    });
  });

  it("round-trips a full agent conversation", () => {
    expect(fromModelMessages(toModelMessages(conversation))).toEqual(conversation);
  });

  it("does not mutate its input and starts a new tool message after each assistant turn", () => {
    const snapshot = structuredClone(conversation);
    const twoRounds: ChatMessage[] = [
      ...conversation.slice(0, 4),
      { role: "assistant", content: "", toolCalls: [{ id: "call_3", name: "web_search", input: { query: "more" } }] },
      { role: "tool", toolCallId: "call_3", toolName: "web_search", output: { results: [] } },
    ];
    const converted = toModelMessages(twoRounds);
    expect(converted.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant", "tool"]);
    expect(conversation).toEqual(snapshot);
  });

  it("makes tool outputs strictly JSON-serializable", () => {
    expect(toJsonValue(undefined)).toBeNull();
    expect(toJsonValue({ at: new Date("2026-01-02T03:04:05.000Z"), skip: undefined, n: 1 })).toEqual({
      at: "2026-01-02T03:04:05.000Z",
      n: 1,
    });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(typeof toJsonValue(circular)).toBe("string");

    const [toolMessage] = toModelMessages([{ role: "tool", toolCallId: "c", toolName: "t", output: undefined }]);
    expect(toolMessage).toEqual({
      role: "tool",
      content: [{ type: "tool-result", toolCallId: "c", toolName: "t", output: { type: "json", value: null } }],
    });
  });

  it("wraps malformed (non-object) tool-call input so the history can still be replayed", () => {
    const [assistant] = toModelMessages([
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "web_search", input: "not json" }, { id: "c2", name: "web_search", input: null }] },
    ]);
    expect(assistant).toMatchObject({
      content: [
        { type: "tool-call", toolCallId: "c1", input: { value: "not json" } },
        { type: "tool-call", toolCallId: "c2", input: {} },
      ],
    });
  });

  it("reads text parts and drops system messages when converting back", () => {
    expect(
      fromModelMessages([
        { role: "system", content: "ignored" },
        { role: "user", content: [{ type: "text", text: "Hello " }, { type: "text", text: "there" }] },
        { role: "tool", content: [{ type: "tool-result", toolCallId: "c", toolName: "t", output: { type: "error-text", value: "nope" } }] },
      ]),
    ).toEqual([
      { role: "user", content: "Hello there" },
      { role: "tool", toolCallId: "c", toolName: "t", output: "nope", isError: true },
    ]);
  });
});
