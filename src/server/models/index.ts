import { AppError, errorMessage, isAppError } from "@/server/errors";
import { buildRequestTrace, buildResponseTrace, recordModelCall, type RequestTrace, type ResponseTrace } from "./persist";
import { computeCostUsd, priceFor } from "./pricing";
import { createAiSdkProvider } from "./providers/ai-sdk";
import { mockProvider } from "./providers/mock";
import { getStatus, isSimulated, providerLabel, routeTier } from "./registry";
import type {
  CallMeta,
  CallTracking,
  GenerateObjectRequest,
  GenerateObjectResult,
  GenerateTextRequest,
  GenerateTextResult,
  Llm,
  ModelProvider,
  ModelTier,
  ModelUsage,
  ProviderId,
  TierRoute,
} from "./types";

export type * from "./types";

// ModelCall.request / .response trace shapes, re-exported for the demo seed so seeded traces match live ones.
export { buildRequestTrace, buildResponseTrace } from "./persist";

const PROVIDERS: Readonly<Record<ProviderId, ModelProvider>> = {
  anthropic: createAiSdkProvider("anthropic"),
  openai: createAiSdkProvider("openai"),
  google: createAiSdkProvider("google"),
  mock: mockProvider,
};

const NO_USAGE: ModelUsage = { inputTokens: 0, outputTokens: 0 };

/** Failed structured-output attempts still consumed tokens; repair.ts passes them along in AppError.details. */
function failureDetails(e: unknown): { usage: ModelUsage; text?: string } {
  const details = isAppError(e) ? (e.details as { usage?: Partial<ModelUsage>; text?: unknown } | undefined) : undefined;
  const usage = details?.usage;
  return {
    usage:
      typeof usage?.inputTokens === "number" && typeof usage.outputTokens === "number"
        ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
        : NO_USAGE,
    text: typeof details?.text === "string" ? details.text : undefined,
  };
}

function toAppError(e: unknown, route: TierRoute): AppError {
  if (isAppError(e)) return e;
  if (route.provider === "mock") {
    // Simulated mode runs our own deterministic producers — a crash there is a bug, not a provider outage.
    return new AppError("INTERNAL", `Simulated model call failed: ${errorMessage(e)}`);
  }
  const statusCode = (e as { statusCode?: unknown } | null)?.statusCode;
  return new AppError("MODEL_ERROR", `${providerLabel(route.provider)} could not complete the request: ${errorMessage(e)}`, {
    provider: route.provider,
    model: route.model,
    ...(typeof statusCode === "number" ? { statusCode } : {}),
  });
}

/**
 * Shared call pipeline: route → provider call → measure latency → price → persist (ModelCall + usage).
 * A failed call is persisted with `error` and surfaces as an AppError; the mock is never a fallback for it.
 */
async function execute<R extends { usage: ModelUsage }>(args: {
  tier: ModelTier;
  tracking: CallTracking;
  request: RequestTrace;
  call: (provider: ModelProvider, model: string) => Promise<R>;
  response: (result: R) => ResponseTrace;
}): Promise<{ result: R; meta: CallMeta }> {
  const { tier, tracking } = args;
  const route = routeTier(tier);
  const simulated = route.provider === "mock";
  const price = priceFor(route.provider, route.model, tier);
  const startedAt = Date.now();
  const base = { tracking, provider: route.provider, model: route.model, tier, simulated, request: args.request };

  let result: R;
  try {
    result = await args.call(PROVIDERS[route.provider], route.model);
  } catch (e) {
    const { usage, text } = failureDetails(e);
    const failure = toAppError(e, route);
    await recordModelCall({
      ...base,
      usage,
      costUsd: computeCostUsd(price, usage.inputTokens, usage.outputTokens),
      latencyMs: Date.now() - startedAt,
      response: text !== undefined ? buildResponseTrace({ text }) : undefined,
      error: failure.message,
    });
    throw failure;
  }

  const latencyMs = Date.now() - startedAt;
  const costUsd = computeCostUsd(price, result.usage.inputTokens, result.usage.outputTokens);
  const modelCallId = await recordModelCall({
    ...base,
    usage: result.usage,
    costUsd,
    latencyMs,
    response: args.response(result),
  });

  return {
    result,
    meta: {
      provider: route.provider,
      model: route.model,
      tier,
      usage: result.usage,
      costUsd,
      latencyMs,
      simulated,
      ...(modelCallId ? { modelCallId } : {}),
    },
  };
}

export const llm: Llm = {
  async generateText(req: GenerateTextRequest, tracking: CallTracking): Promise<GenerateTextResult> {
    const { result, meta } = await execute({
      tier: req.tier,
      tracking,
      request: buildRequestTrace({
        system: req.system,
        messages: req.messages,
        tools: (req.tools ?? []).map((t) => t.name),
      }),
      call: (provider, model) => provider.generateText(model, req),
      response: (r) => buildResponseTrace({ text: r.text, toolCalls: r.toolCalls, finishReason: r.finishReason }),
    });
    return { ...meta, text: result.text, toolCalls: result.toolCalls, finishReason: result.finishReason };
  },

  async generateObject<T>(req: GenerateObjectRequest<T>, tracking: CallTracking): Promise<GenerateObjectResult<T>> {
    const { result, meta } = await execute({
      tier: req.tier,
      tracking,
      request: buildRequestTrace({ system: req.system, prompt: req.prompt, schemaName: req.schemaName }),
      call: (provider, model) => provider.generateObject<T>(model, req),
      response: (r) => buildResponseTrace({ object: r.object }),
    });
    return { ...meta, object: result.object };
  },

  status: getStatus,

  isSimulated,

  route: routeTier,

  priceFor,

  /** Priced at the tier's CURRENT route, so estimates match what a run would actually be charged (reference price when simulated). */
  estimateCostUsd(tier: ModelTier, inputTokens: number, outputTokens: number): number {
    const route = routeTier(tier);
    return computeCostUsd(priceFor(route.provider, route.model, tier), inputTokens, outputTokens);
  },
};
