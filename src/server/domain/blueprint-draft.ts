import { z } from "zod";
import { ModelTierSchema } from "./blueprint";

/**
 * BlueprintDraft — the ONLY thing the Staffing Engine's LLM is asked to produce when designing a worker.
 * Deliberately flat (no unions, no optionals, no bounds) so it works with every provider's structured
 * output. `staffing.designBlueprint(spec, draft)` deterministically turns it into a full, validated
 * WorkerBlueprint: wiring context keys, deterministic components, deliverable, limits, KPIs, evaluation
 * plan and cost estimate. Simulated mode builds the same draft from job-family templates.
 */

export const AgentDraftSchema = z.object({
  name: z.string().describe("Short role name, e.g. 'Researcher'"),
  description: z.string().describe("One sentence on what this agent does"),
  goal: z.string().describe("What this agent must accomplish in one run"),
  instructions: z.string().describe("Full system prompt for the agent: method, quality bar, output rules"),
  modelTier: ModelTierSchema.describe("fast = cheap/simple, standard = default, reasoning = hard analysis"),
  tools: z.array(z.string()).describe("Tool names from the provided registry list only"),
});
export type AgentDraft = z.infer<typeof AgentDraftSchema>;

export const BlueprintDraftSchema = z.object({
  persona: z.object({
    name: z.string().describe("A human first name"),
    title: z.string().describe("Role title, e.g. 'AI Market Researcher'"),
    summary: z.string().describe("2-3 sentence contractor-style bio"),
  }),
  responsibilities: z.array(z.string()),
  /** Gathers/produces the structured records (JSON array). Always present. Component id: `collector`. */
  collector: AgentDraftSchema,
  /** Writes narrative insights (markdown) from records/stats. Used only for markdown deliverables. Component id: `analyst`. */
  analyst: AgentDraftSchema,
  steps: z.object({
    validate: z.boolean().describe("Drop records missing required fields"),
    dedupe: z.boolean(),
    rank: z.boolean(),
    computeStats: z.boolean().describe("Aggregate counts by groupBy + numeric summaries"),
    notify: z.boolean().describe("Send the finished deliverable to stakeholders (approval-gated)"),
  }),
  /** Field names identifying a unique record (dedupe + no_duplicates check). */
  keyFields: z.array(z.string()),
  /** Field to rank by; "" = none. */
  rankBy: z.string(),
  rankDirection: z.enum(["asc", "desc"]),
  /** Field to group stats by; "" = none. */
  groupBy: z.string(),
  toolReasons: z.array(z.object({ toolName: z.string(), reason: z.string() })),
  /** Why the worker was designed this way — shown on the proposal card. */
  rationale: z.array(z.string()),
});
export type BlueprintDraft = z.infer<typeof BlueprintDraftSchema>;
