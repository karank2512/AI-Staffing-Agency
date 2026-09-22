import type { FinishReason, LanguageModel, LanguageModelUsage, ToolSet } from "ai";
import { AppError } from "@/server/errors";
import { toModelMessages } from "../messages";
import { isProviderAvailable, providerApiKey, providerLabel, type LiveProviderId } from "../registry";
import { formatIssues, generateObjectWithReask, repairJsonText, validateObject, type ObjectAttempt } from "../repair";
import { withTransientRetry } from "../retry";
import type {
  GenerateObjectRequest,
  GenerateTextRequest,
  GenerateTextResult,
  ModelProvider,
  ModelUsage,
} from "../types";

/**
 * The one live adapter, parameterized by provider id (Vercel AI SDK v5).
 *
 * - The SDK is imported lazily: Simulated mode (and every test) never pays for loading it.
 * - Tools are declared WITHOUT `execute`, so the SDK returns the tool calls and stops after one step — the runtime
 *   owns the agent loop, permissions and approvals.
 * - `maxRetries: 0`: retries are ours (see retry.ts).
 * - Never enable OpenAI `strictJsonSchema` or Anthropic `structuredOutputMode: "outputFormat"` — our Zod schemas use
 *   optionals/defaults those modes reject. Provider defaults (JSON tool / non-strict schema) are what we want.
 */

/** Non-streaming default; leaves room for thinking tokens on models that think by default. */
const DEFAULT_MAX_OUTPUT_TOKENS = 16_000;
/** A hung request must not pin a run forever. A timeout counts as transient and is retried. */
const CALL_TIMEOUT_MS = 240_000;

async function languageModel(id: LiveProviderId, model: string): Promise<LanguageModel> {
  const apiKey = providerApiKey(id);
  if (!apiKey) throw new AppError("MODEL_ERROR", `${providerLabel(id)} is not configured on this server`);
  switch (id) {
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      return createAnthropic({ apiKey })(model);
    }
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      return createOpenAI({ apiKey })(model);
    }
    case "google": {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      return createGoogleGenerativeAI({ apiKey })(model);
    }
  }
}

export function mapFinishReason(reason: FinishReason, hasToolCalls: boolean): GenerateTextResult["finishReason"] {
  if (hasToolCalls || reason === "tool-calls") return "tool_calls";
  if (reason === "stop") return "stop";
  if (reason === "length") return "length";
  return "other";
}

/**
 * Billable usage. Gemini reports thinking tokens outside `outputTokens` (but bills them as output), so prefer
 * `totalTokens - inputTokens` whenever it is larger.
 */
export function toUsage(usage: LanguageModelUsage | undefined): ModelUsage {
  const inputTokens = usage?.inputTokens ?? 0;
  const reported = usage?.outputTokens ?? 0;
  const derived = usage?.totalTokens !== undefined ? usage.totalTokens - inputTokens : 0;
  return { inputTokens, outputTokens: Math.max(reported, derived, 0) };
}

/** OpenAI requires ^[a-zA-Z0-9_-]{1,64}$ for schema names; call sites use dotted names like "scoping.spec". */
function providerSchemaName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "output";
}

function hasIssues(value: unknown): value is { issues: unknown[] } {
  return value !== null && typeof value === "object" && Array.isArray((value as { issues?: unknown }).issues);
}

/** Turn the SDK's NoObjectGeneratedError into feedback the model can act on in the re-ask. */
function describeObjectFailure(error: { message: string; cause?: unknown; finishReason?: FinishReason }): string {
  if (error.finishReason === "length") {
    return "- (root): the response was cut off before the JSON was complete — respond more concisely";
  }
  // TypeValidationError.cause is whatever our validator returned: a ZodError (has issues) or a normalize() error.
  let cause: unknown = error.cause;
  for (let depth = 0; depth < 3 && cause !== null && typeof cause === "object"; depth++) {
    if (hasIssues(cause)) return formatIssues(cause as Parameters<typeof formatIssues>[0]);
    cause = (cause as { cause?: unknown }).cause;
  }
  const name = (error.cause as { name?: unknown } | undefined)?.name;
  if (typeof name === "string" && name.includes("JSONParse")) return "- (root): the response was not valid JSON";
  return `- (root): ${error.message}`;
}

export interface AiSdkProviderOptions {
  /** Test seam: supply the SDK model (e.g. `MockLanguageModelV2`) instead of building one from the env key. */
  resolveModel?: (model: string) => LanguageModel | Promise<LanguageModel>;
}

export function createAiSdkProvider(id: LiveProviderId, options: AiSdkProviderOptions = {}): ModelProvider {
  const resolveModel = options.resolveModel ?? ((model: string) => languageModel(id, model));
  return {
    id,

    isAvailable: () => isProviderAvailable(id),

    async generateText(model: string, req: GenerateTextRequest) {
      const ai = await import("ai");
      const languageModelInstance = await resolveModel(model);

      const toolSet: ToolSet = {};
      for (const spec of req.tools ?? []) {
        toolSet[spec.name] = ai.tool({ description: spec.description, inputSchema: spec.inputSchema });
      }
      const hasTools = Object.keys(toolSet).length > 0;

      const result = await withTransientRetry(() =>
        ai.generateText({
          model: languageModelInstance,
          system: req.system,
          messages: toModelMessages(req.messages),
          // Some providers reject an empty tools array, so only send tools when there are any.
          ...(hasTools ? { tools: toolSet, toolChoice: "auto" as const } : {}),
          maxOutputTokens: req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        }),
      );

      // Malformed calls (unknown tool, unparsable input) are passed through untouched: tools.invoke() validates the
      // input and answers with an error tool message, which lets the agent correct itself.
      const toolCalls = result.toolCalls.map((call) => ({ id: call.toolCallId, name: call.toolName, input: call.input }));
      return {
        text: result.text,
        toolCalls,
        finishReason: mapFinishReason(result.finishReason, toolCalls.length > 0),
        usage: toUsage(result.usage),
      };
    },

    async generateObject<T>(model: string, req: GenerateObjectRequest<T>) {
      const ai = await import("ai");
      const languageModelInstance = await resolveModel(model);

      // The provider gets the JSON Schema derived from the Zod schema, but VALIDATION is ours: normalize → Zod.
      // When it fails the SDK runs `experimental_repairText` (null stripping) and validates once more.
      const schema = ai.jsonSchema<T>(() => ai.zodSchema(req.schema).jsonSchema, {
        validate: (raw) => {
          const validated = validateObject<T>(raw, req);
          return validated.ok ? { success: true, value: validated.object } : { success: false, error: validated.error };
        },
      });

      const attempt = async (prompt: string): Promise<ObjectAttempt<T>> => {
        try {
          const result = await withTransientRetry(() =>
            ai.generateObject({
              model: languageModelInstance,
              system: req.system,
              prompt,
              schema,
              schemaName: providerSchemaName(req.schemaName),
              maxOutputTokens: req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
              ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
              maxRetries: 0,
              experimental_repairText: repairJsonText,
              abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
            }),
          );
          return { ok: true, object: result.object, usage: toUsage(result.usage) };
        } catch (e) {
          if (ai.NoObjectGeneratedError.isInstance(e)) {
            return { ok: false, issues: describeObjectFailure(e), text: e.text, usage: toUsage(e.usage) };
          }
          throw e;
        }
      };

      return generateObjectWithReask(req, attempt);
    },
  };
}
