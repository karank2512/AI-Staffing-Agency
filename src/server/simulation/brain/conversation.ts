import type { ChatMessage, MockTextResponse, ToolSpec } from "@/server/models/types";
import { TOOL_INPUT_SCHEMAS, type ToolName } from "@/server/tools/schemas";

/**
 * The mock brain is STATELESS: every turn it re-derives where it is from the conversation alone (which is
 * also what makes approval pauses / crash recovery work — the runtime just replays the checkpointed messages).
 */

export interface ToolExchange {
  id: string;
  name: string;
  input: unknown;
  /** True once a tool message with this call id exists. */
  answered: boolean;
  output?: unknown;
  isError: boolean;
  errorMessage?: string;
}

export interface ConversationState {
  /** Assistant turns already taken (the turn being produced now is `assistantTurns + 1`). */
  assistantTurns: number;
  exchanges: ToolExchange[];
}

function errorOf(message: Extract<ChatMessage, { role: "tool" }>): string | undefined {
  const out = message.output;
  const text = typeof out === "object" && out !== null && "error" in out ? String((out as { error: unknown }).error) : undefined;
  if (message.isError) return text ?? "tool call failed";
  // Some callers may omit isError; a bare `{ error }` object is still an error.
  return text !== undefined && Object.keys(out as object).length === 1 ? text : undefined;
}

export function readConversation(messages: readonly ChatMessage[]): ConversationState {
  const exchanges: ToolExchange[] = [];
  const byId = new Map<string, ToolExchange>();
  let assistantTurns = 0;
  for (const m of messages) {
    if (m.role === "assistant") {
      assistantTurns++;
      for (const call of m.toolCalls ?? []) {
        const ex: ToolExchange = { id: call.id, name: call.name, input: call.input, answered: false, isError: false };
        exchanges.push(ex);
        byId.set(call.id, ex);
      }
    } else if (m.role === "tool") {
      // Match by id; fall back to the oldest unanswered call of the same tool (ids can be re-issued on resume).
      const ex = byId.get(m.toolCallId) ?? exchanges.find((e) => e.name === m.toolName && !e.answered);
      if (!ex) continue;
      const error = errorOf(m);
      ex.answered = true;
      ex.output = m.output;
      ex.isError = error !== undefined;
      ex.errorMessage = error;
    }
  }
  return { assistantTurns, exchanges };
}

export class Conversation {
  readonly state: ConversationState;
  private readonly available: Set<string>;

  constructor(messages: readonly ChatMessage[], tools: readonly ToolSpec[], private readonly maxTurns: number) {
    this.state = readConversation(messages);
    this.available = new Set(tools.map((t) => t.name));
  }

  /** Turns left INCLUDING the one being produced now. At 1, the only safe move is the final answer. */
  get remainingTurns(): number {
    return this.maxTurns - this.state.assistantTurns;
  }

  has(tool: ToolName): boolean {
    return this.available.has(tool);
  }

  /** Requested at least once (answered or not) — each tool is used in at most one turn, so plans always terminate. */
  attempted(tool: ToolName): boolean {
    return this.state.exchanges.some((e) => e.name === tool);
  }

  /** Granted and not yet tried. */
  canTry(tool: ToolName): boolean {
    return this.has(tool) && !this.attempted(tool);
  }

  succeeded(tool: ToolName): ToolExchange[] {
    return this.state.exchanges.filter((e) => e.name === tool && e.answered && !e.isError);
  }

  failed(tool?: ToolName): ToolExchange[] {
    return this.state.exchanges.filter((e) => e.isError && (tool === undefined || e.name === tool));
  }
}

/**
 * Build an assistant turn that calls tools — dropping any call that is not granted or whose input would fail
 * the tool's frozen Zod schema (so the brain can never burn a turn on `invalid_input`). Returns null when
 * nothing valid is left, which tells the caller to move on to its next step.
 */
export function toolTurn(
  convo: Conversation,
  text: string,
  calls: Array<{ name: ToolName; input: unknown }>,
): MockTextResponse | null {
  const valid = calls.filter((c) => convo.has(c.name) && TOOL_INPUT_SCHEMAS[c.name].safeParse(c.input).success);
  return valid.length > 0 ? { text, toolCalls: valid } : null;
}

export function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
