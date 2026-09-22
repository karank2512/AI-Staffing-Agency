import type { z } from "zod";
import type { ModelTier } from "@/server/domain/blueprint";

/**
 * Model layer contract.
 *
 * Callers NEVER talk to the Vercel AI SDK directly. They call `llm.generateText` / `llm.generateObject`
 * (src/server/models/index.ts) with a TIER, and the registry routes to the best available provider.
 *
 * Every call site MUST supply a deterministic `mock` producer. It is used only when no provider is
 * available (Simulated mode) — never as a silent fallback for a failed live call.
 */

export type { ModelTier };

export type ProviderId = "anthropic" | "openai" | "google" | "mock";

export interface ToolCallRequest {
  /** Provider-issued id; echoed back in the matching tool message. */
  id: string;
  name: string;
  input: unknown;
}

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCallRequest[] }
  | {
      role: "tool";
      toolCallId: string;
      toolName: string;
      /** JSON-serializable tool output (or { error: string }). */
      output: unknown;
      isError?: boolean;
    };

/** A tool as presented to the model. Execution happens in the runtime, never inside the model layer. */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: z.ZodType;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Attribution for cost tracking. Every call is persisted as ModelCall + UsageRecord unless persist=false. */
export interface CallTracking {
  organizationId: string;
  /** e.g. "scoping.questions", "scoping.spec", "staffing.blueprint", "agent.turn", "evaluation.judge",
   *  "review.narrative", "chat.classify", "chat.reply", "replace.plan" */
  purpose: string;
  workerId?: string;
  jobId?: string;
  runId?: string;
  runStepId?: string;
  /** Skip DB persistence (unit tests / dry runs). Default true. */
  persist?: boolean;
}

export interface MockTextResponse {
  text: string;
  toolCalls?: Array<{ name: string; input: unknown }>;
}

export interface GenerateTextRequest {
  tier: ModelTier;
  system?: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  maxOutputTokens?: number;
  temperature?: number;
  /** Deterministic stand-in used in Simulated mode. Receives the same conversation the model would. */
  mock: (input: { system?: string; messages: ChatMessage[]; tools: ToolSpec[] }) => MockTextResponse | Promise<MockTextResponse>;
}

export interface CallMeta {
  provider: ProviderId;
  model: string;
  tier: ModelTier;
  usage: ModelUsage;
  costUsd: number;
  latencyMs: number;
  simulated: boolean;
  /** ModelCall row id when persisted. */
  modelCallId?: string;
}

export interface GenerateTextResult extends CallMeta {
  text: string;
  toolCalls: ToolCallRequest[];
  finishReason: "stop" | "tool_calls" | "length" | "other";
}

export interface GenerateObjectRequest<T> {
  tier: ModelTier;
  system?: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** Short name for the schema (provider hint + debug trace). */
  schemaName: string;
  maxOutputTokens?: number;
  temperature?: number;
  /**
   * Applied to the raw parsed value BEFORE schema validation on both live and mock paths. Use it to clamp what
   * providers don't enforce: `.slice(0, 3)` arrays, clamp scores to 0..1, drop nulls for optionals, add constants.
   */
  normalize?: (raw: unknown) => unknown;
  /** Deterministic stand-in used in Simulated mode. Its return value is validated against `schema` too. */
  mock: () => T | Promise<T>;
}

export interface GenerateObjectResult<T> extends CallMeta {
  object: T;
}

/** Low-level provider adapter. Implementations: AI-SDK-backed (anthropic/openai/google) and mock. */
export interface ModelProvider {
  readonly id: ProviderId;
  isAvailable(): boolean;
  generateText(
    model: string,
    req: GenerateTextRequest,
  ): Promise<{ text: string; toolCalls: ToolCallRequest[]; finishReason: GenerateTextResult["finishReason"]; usage: ModelUsage }>;
  generateObject<T>(model: string, req: GenerateObjectRequest<T>): Promise<{ object: T; usage: ModelUsage }>;
}

export interface ModelPrice {
  /** USD per 1M tokens. */
  inputPerMTok: number;
  outputPerMTok: number;
}

export interface TierRoute {
  provider: ProviderId;
  model: string;
}

export interface ModelStatus {
  mode: "live" | "simulated";
  providers: Array<{ id: ProviderId; label: string; available: boolean; envVar: string | null }>;
  tiers: Record<ModelTier, TierRoute>;
}

/** The public surface of src/server/models/index.ts (exported as `llm`). */
export interface Llm {
  generateText(req: GenerateTextRequest, tracking: CallTracking): Promise<GenerateTextResult>;
  generateObject<T>(req: GenerateObjectRequest<T>, tracking: CallTracking): Promise<GenerateObjectResult<T>>;
  status(): ModelStatus;
  isSimulated(): boolean;
  /** Route a tier to a concrete provider/model given current env. */
  route(tier: ModelTier): TierRoute;
  /** Price lookup; unknown models fall back to the tier's reference price. */
  priceFor(provider: ProviderId, model: string, tier: ModelTier): ModelPrice;
  /** Pure cost math used by both live tracking and the Staffing Engine's estimates. */
  estimateCostUsd(tier: ModelTier, inputTokens: number, outputTokens: number): number;
}
