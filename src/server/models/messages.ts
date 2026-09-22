import type { JSONValue, ModelMessage, TextPart, ToolCallPart, ToolResultPart } from "ai";
import type { ChatMessage, ToolCallRequest } from "./types";

/**
 * ChatMessage[] ↔ AI SDK v5 ModelMessage[] conversion. Pure (type-only SDK imports), so it is unit-testable
 * without loading the SDK.
 */

/** Tool outputs are arbitrary domain objects; providers need strict JSON (no undefined / Date / BigInt). */
export function toJsonValue(value: unknown): JSONValue {
  if (value === undefined) return null;
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? null : (JSON.parse(serialized) as JSONValue);
  } catch {
    // Circular structure, BigInt … — degrade to a string rather than failing the whole model call.
    return String(value);
  }
}

/**
 * Providers require tool-call arguments to be a JSON object. A malformed call (the model emitted a string or an
 * array) still has to be replayed in the history next to its error result, so wrap it instead of failing the request.
 */
function toolCallInput(input: unknown): unknown {
  if (input !== null && typeof input === "object" && !Array.isArray(input)) return input;
  return input === null || input === undefined ? {} : { value: toJsonValue(input) };
}

function toolResultPart(message: Extract<ChatMessage, { role: "tool" }>): ToolResultPart {
  const value = toJsonValue(message.output);
  return {
    type: "tool-result",
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    output: message.isError ? { type: "error-json", value } : { type: "json", value },
  };
}

export function toModelMessages(messages: readonly ChatMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: message.content });
      continue;
    }

    if (message.role === "assistant") {
      const toolCalls = message.toolCalls ?? [];
      if (toolCalls.length === 0) {
        out.push({ role: "assistant", content: message.content });
        continue;
      }
      const parts: Array<TextPart | ToolCallPart> = [];
      // Anthropic rejects empty text blocks, and tool-calling turns usually have no prose.
      if (message.content.trim().length > 0) parts.push({ type: "text", text: message.content });
      for (const call of toolCalls) {
        parts.push({ type: "tool-call", toolCallId: call.id, toolName: call.name, input: toolCallInput(call.input) });
      }
      out.push({ role: "assistant", content: parts });
      continue;
    }

    // Results of parallel tool calls must travel together: providers expect ONE tool message answering the
    // preceding assistant turn, so consecutive tool messages are merged.
    const part = toolResultPart(message);
    const previous = out[out.length - 1];
    if (previous?.role === "tool") previous.content.push(part);
    else out.push({ role: "tool", content: [part] });
  }
  return out;
}

function joinText(content: string | ReadonlyArray<{ type: string; text?: string }>): string {
  if (typeof content === "string") return content;
  return content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

/** Inverse of `toModelMessages`. System messages are dropped (ChatMessage carries `system` out of band). */
export function fromModelMessages(messages: readonly ModelMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;

    if (message.role === "user") {
      out.push({ role: "user", content: joinText(message.content) });
      continue;
    }

    if (message.role === "assistant") {
      const toolCalls: ToolCallRequest[] =
        typeof message.content === "string"
          ? []
          : message.content
              .filter((part): part is ToolCallPart => part.type === "tool-call")
              .map((part) => ({ id: part.toolCallId, name: part.toolName, input: part.input }));
      const content = joinText(message.content);
      out.push(toolCalls.length > 0 ? { role: "assistant", content, toolCalls } : { role: "assistant", content });
      continue;
    }

    for (const part of message.content) {
      const isError = part.output.type === "error-json" || part.output.type === "error-text";
      out.push({
        role: "tool",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        output: part.output.value,
        ...(isError ? { isError: true } : {}),
      });
    }
  }
  return out;
}
