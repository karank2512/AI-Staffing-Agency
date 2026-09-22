import { z } from "zod";

/** Stored in WorkerVersion.analysis for PROPOSED versions created by the Replace / spec-change flows. */

export const FailurePatternSchema = z.object({
  pattern: z.string(),
  evidence: z.string(),
  /** How many runs/deliverables in the window showed it. */
  occurrences: z.number().int().min(0),
  severity: z.enum(["low", "medium", "high"]),
});
export type FailurePattern = z.infer<typeof FailurePatternSchema>;

export const BLUEPRINT_CHANGE_AREAS = [
  "instructions",
  "model",
  "tools",
  "pipeline",
  "evaluation",
  "limits",
  "schedule",
  "deliverable",
] as const;

export const BlueprintChangeSchema = z.object({
  area: z.enum(BLUEPRINT_CHANGE_AREAS),
  description: z.string(),
  rationale: z.string(),
});
export type BlueprintChange = z.infer<typeof BlueprintChangeSchema>;

export const EstimatedDeltasSchema = z.object({
  /** Percent change vs the current version. Positive quality = better; negative cost/latency = cheaper/faster. */
  qualityPct: z.number(),
  costPct: z.number(),
  latencyPct: z.number(),
});
export type EstimatedDeltas = z.infer<typeof EstimatedDeltasSchema>;

export const ReplacementAnalysisSchema = z.object({
  summary: z.string(),
  failurePatterns: z.array(FailurePatternSchema),
  rootCauses: z.array(z.string()),
  changes: z.array(BlueprintChangeSchema),
  estimatedDeltas: EstimatedDeltasSchema,
  basedOn: z.object({
    runs: z.number().int(),
    failedRuns: z.number().int(),
    evaluations: z.number().int(),
    rejectedDeliverables: z.number().int(),
    windowDays: z.number().int(),
  }),
  simulated: z.boolean(),
});
export type ReplacementAnalysis = z.infer<typeof ReplacementAnalysisSchema>;

/** What the LLM returns for a replacement analysis (the new blueprint is assembled + validated in code). */
export const ReplacementPlanSchema = z.object({
  summary: z.string(),
  failurePatterns: z.array(FailurePatternSchema).max(6),
  rootCauses: z.array(z.string()).max(6),
  changes: z.array(BlueprintChangeSchema).min(1).max(8),
  /** Per-agent-component instruction rewrites: componentId → new instructions. */
  instructionRewrites: z.array(z.object({ componentId: z.string(), instructions: z.string() })),
  /** Per-agent-component tier changes. */
  tierChanges: z.array(z.object({ componentId: z.string(), modelTier: z.enum(["fast", "standard", "reasoning"]) })),
  addValidationStep: z.boolean(),
  addDedupeStep: z.boolean(),
  estimatedDeltas: EstimatedDeltasSchema,
});
export type ReplacementPlan = z.infer<typeof ReplacementPlanSchema>;

export interface BlueprintDiffEntry {
  /** Dot path, e.g. "components.researcher.modelTier". */
  path: string;
  /** Human label, e.g. "Researcher · model tier". */
  label: string;
  kind: "added" | "removed" | "changed";
  before?: string;
  after?: string;
}

export interface BlueprintDiff {
  entries: BlueprintDiffEntry[];
}

/** Chat message classification returned by the LLM (talk-to-worker). */
export const MessageClassificationSchema = z.object({
  classification: z.enum(["QUESTION", "TEMPORARY_INSTRUCTION", "SPEC_CHANGE"]),
  confidence: z.number().min(0).max(1),
  /** For instructions/spec changes: the normalized instruction, imperative voice. */
  normalizedInstruction: z.string().optional(),
  reasoning: z.string(),
});
export type MessageClassificationResult = z.infer<typeof MessageClassificationSchema>;
