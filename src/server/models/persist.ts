import { db, toJson } from "@/server/db";
import { recordUsage } from "@/server/usage";
import type { CallTracking, ChatMessage, GenerateTextResult, ModelTier, ModelUsage, ProviderId, ToolCallRequest } from "./types";

/**
 * ModelCall + usage recording. `models` is the ONLY writer of ModelCall rows; Run cost/token rollups are written by
 * `usage.recordUsage` (never here). Nothing in this file may throw — losing a trace row must not fail a model call.
 */

export const MAX_TRACE_STRING_CHARS = 2_000;
export const TRUNCATION_MARKER = "…[truncated]";
export const MAX_TRACE_MESSAGES = 12;
/** Safety net for huge tool outputs made of many short strings (string clipping alone would not bound those). */
const MAX_TRACE_ARRAY_ITEMS = 100;
const MAX_TRACE_DEPTH = 12;

export function clipString(value: string): string {
  return value.length > MAX_TRACE_STRING_CHARS ? `${value.slice(0, MAX_TRACE_STRING_CHARS)}${TRUNCATION_MARKER}` : value;
}

/**
 * Bound a trace by clipping individual STRING FIELDS. Serialized JSON is never sliced, so the stored trace always
 * stays valid, browsable JSON.
 */
export function clipDeep(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return clipString(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_TRACE_DEPTH) return TRUNCATION_MARKER;
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_TRACE_ARRAY_ITEMS).map((item) => clipDeep(item, depth + 1));
    if (value.length > MAX_TRACE_ARRAY_ITEMS) items.push(`…[${value.length - MAX_TRACE_ARRAY_ITEMS} more items]`);
    return items;
  }
  if (value instanceof Date) return value.toISOString();
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) out[key] = clipDeep(child, depth + 1);
  return out;
}

export interface RequestTrace {
  system?: string;
  messages?: ChatMessage[];
  /** Present only when older messages were dropped to keep the last MAX_TRACE_MESSAGES. */
  omittedMessages?: number;
  prompt?: string;
  tools?: string[];
  schemaName?: string;
}

export interface ResponseTrace {
  text?: string;
  toolCalls?: ToolCallRequest[];
  object?: unknown;
  finishReason?: GenerateTextResult["finishReason"];
}

export function buildRequestTrace(input: {
  system?: string;
  messages?: readonly ChatMessage[];
  prompt?: string;
  tools?: readonly string[];
  schemaName?: string;
}): RequestTrace {
  const trace: RequestTrace = {};
  if (input.system !== undefined) trace.system = input.system;
  if (input.messages) {
    const omitted = Math.max(0, input.messages.length - MAX_TRACE_MESSAGES);
    trace.messages = input.messages.slice(-MAX_TRACE_MESSAGES);
    if (omitted > 0) trace.omittedMessages = omitted;
  }
  if (input.prompt !== undefined) trace.prompt = input.prompt;
  if (input.tools && input.tools.length > 0) trace.tools = [...input.tools];
  if (input.schemaName !== undefined) trace.schemaName = input.schemaName;
  return clipDeep(trace) as RequestTrace;
}

export function buildResponseTrace(input: ResponseTrace): ResponseTrace {
  const trace: ResponseTrace = {};
  if (input.text !== undefined) trace.text = input.text;
  if (input.toolCalls && input.toolCalls.length > 0) trace.toolCalls = input.toolCalls;
  if (input.object !== undefined) trace.object = input.object;
  if (input.finishReason !== undefined) trace.finishReason = input.finishReason;
  return clipDeep(trace) as ResponseTrace;
}

export interface ModelCallRecord {
  tracking: CallTracking;
  provider: ProviderId;
  model: string;
  tier: ModelTier;
  usage: ModelUsage;
  costUsd: number;
  latencyMs: number;
  simulated: boolean;
  request: RequestTrace;
  response?: ResponseTrace;
  error?: string;
}

/**
 * Persist one model call (ModelCall row + MODEL usage). Returns the ModelCall id, or undefined when persistence is
 * disabled or failed. NEVER throws.
 */
export async function recordModelCall(record: ModelCallRecord): Promise<string | undefined> {
  try {
    return await persistModelCall(record);
  } catch (e) {
    // Belt and braces (e.g. a caller bypassed the types and sent no tracking): tracing must never fail the call.
    console.error("[models] Failed to record model call", e);
    return undefined;
  }
}

async function persistModelCall(record: ModelCallRecord): Promise<string | undefined> {
  const { tracking } = record;
  if (tracking.persist === false) return undefined;

  let modelCallId: string | undefined;
  try {
    const row = await db.modelCall.create({
      data: {
        organizationId: tracking.organizationId,
        workerId: tracking.workerId ?? null,
        jobId: tracking.jobId ?? null,
        runId: tracking.runId ?? null,
        runStepId: tracking.runStepId ?? null,
        purpose: tracking.purpose,
        provider: record.provider,
        model: record.model,
        tier: record.tier,
        inputTokens: record.usage.inputTokens,
        outputTokens: record.usage.outputTokens,
        costUsd: record.costUsd,
        latencyMs: Math.max(0, Math.round(record.latencyMs)),
        simulated: record.simulated,
        request: toJson(record.request),
        ...(record.response ? { response: toJson(record.response) } : {}),
        error: record.error ? clipString(record.error) : null,
      },
      select: { id: true },
    });
    modelCallId = row.id;
  } catch (e) {
    console.error(`[models] Failed to persist ModelCall (${tracking.purpose})`, e);
  }

  // A failed call is only metered when the provider actually consumed tokens (e.g. two invalid structured outputs).
  const billable = record.usage.inputTokens > 0 || record.usage.outputTokens > 0;
  if (!record.error || billable) {
    try {
      await recordUsage({
        organizationId: tracking.organizationId,
        kind: "MODEL",
        provider: record.provider,
        resource: record.model,
        inputTokens: record.usage.inputTokens,
        outputTokens: record.usage.outputTokens,
        costUsd: record.costUsd,
        simulated: record.simulated,
        workerId: tracking.workerId,
        jobId: tracking.jobId,
        runId: tracking.runId,
      });
    } catch (e) {
      // recordUsage promises not to throw; this guard keeps OUR promise even if that contract is ever broken.
      console.error(`[models] Failed to record usage (${tracking.purpose})`, e);
    }
  }

  return modelCallId;
}
