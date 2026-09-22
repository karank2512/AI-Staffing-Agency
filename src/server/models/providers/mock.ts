import { AppError } from "@/server/errors";
import { validateObject } from "../repair";
import type { GenerateObjectRequest, GenerateTextRequest, ModelProvider, ModelUsage, ToolCallRequest } from "../types";

/**
 * Simulated-mode provider. It never invents content: every call site supplies a deterministic `mock` producer and
 * this adapter only shapes its output like a real provider response (tool-call ids, finish reason, usage).
 */

const CHARS_PER_TOKEN = 4;

export function estimateTokens(chars: number): number {
  return Math.ceil(Math.max(0, chars) / CHARS_PER_TOKEN);
}

function jsonLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

/** FNV-1a — a tiny stable string hash (models must not depend on the simulation module). */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Simulated work should not look instantaneous in the product (live run view, chat). 150–600 ms, derived from the
 * prompt so it is reproducible; skipped under Vitest to keep suites fast.
 */
async function artificialLatency(seed: string): Promise<void> {
  if (process.env.VITEST) return;
  const ms = 150 + (hash(seed) % 451);
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export const mockProvider: ModelProvider = {
  id: "mock",

  isAvailable: () => true,

  async generateText(_model: string, req: GenerateTextRequest) {
    const tools = req.tools ?? [];
    const messagesJson = JSON.stringify(req.messages);
    await artificialLatency(`${req.system ?? ""}${messagesJson}`);

    const produced = await req.mock({ system: req.system, messages: req.messages, tools });
    const text = typeof produced.text === "string" ? produced.text : "";

    // Ids must be reproducible across identical conversations: the turn index is the number of assistant messages
    // already in the conversation. A real provider cannot call a tool it was not offered, so those are dropped.
    const turn = req.messages.filter((m) => m.role === "assistant").length;
    const offered = new Set(tools.map((t) => t.name));
    const toolCalls: ToolCallRequest[] = (produced.toolCalls ?? [])
      .filter((call) => offered.has(call.name))
      .map((call, i) => ({ id: `mock_${turn}_${i}`, name: call.name, input: call.input }));

    const usage: ModelUsage = {
      inputTokens: estimateTokens((req.system ?? "").length + messagesJson.length),
      outputTokens: estimateTokens(text.length + (toolCalls.length > 0 ? jsonLength(toolCalls) : 0)),
    };
    return { text, toolCalls, finishReason: toolCalls.length > 0 ? ("tool_calls" as const) : ("stop" as const), usage };
  },

  async generateObject<T>(_model: string, req: GenerateObjectRequest<T>) {
    await artificialLatency(`${req.system ?? ""}${req.prompt}`);

    const raw = await req.mock();
    const validated = validateObject<T>(raw, req);
    if (!validated.ok) {
      // The mock is our own code: failing its own schema is a bug at the call site, not a model error.
      throw new AppError(
        "INTERNAL",
        `Mock output for "${req.schemaName}" does not match its schema:\n${validated.issues}`,
        { schemaName: req.schemaName, issues: "issues" in validated.error ? validated.error.issues : validated.issues },
      );
    }

    const usage: ModelUsage = {
      inputTokens: estimateTokens((req.system ?? "").length + req.prompt.length),
      outputTokens: estimateTokens(jsonLength(validated.object)),
    };
    return { object: validated.object, usage };
  },
};
