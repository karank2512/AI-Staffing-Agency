import { z } from "zod";

/** Stored in Evaluation.details — discriminated by `kind`. */

export const CheckResultSchema = z.object({
  id: z.string(),
  type: z.string(),
  description: z.string(),
  passed: z.boolean(),
  /** 0..1 — partial credit allowed (e.g. 80% field completeness). */
  score: z.number().min(0).max(1),
  weight: z.number().positive(),
  observed: z.string(),
  expected: z.string(),
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

export const DeterministicDetailsSchema = z.object({
  kind: z.literal("deterministic"),
  checks: z.array(CheckResultSchema),
});

export const JudgeCriterionResultSchema = z.object({
  id: z.string(),
  criterion: z.string(),
  score: z.number().min(0).max(1),
  weight: z.number().positive(),
  reasoning: z.string(),
});
export type JudgeCriterionResult = z.infer<typeof JudgeCriterionResultSchema>;

export const JudgeDetailsSchema = z.object({
  kind: z.literal("llm_judge"),
  criteria: z.array(JudgeCriterionResultSchema),
  overallReasoning: z.string(),
  model: z.string(),
  simulated: z.boolean(),
});

export const UserFeedbackDetailsSchema = z.object({
  kind: z.literal("user_feedback"),
  decision: z.enum(["accepted", "rejected"]),
  feedback: z.string().optional(),
});

export const EvaluationDetailsSchema = z.discriminatedUnion("kind", [
  DeterministicDetailsSchema,
  JudgeDetailsSchema,
  UserFeedbackDetailsSchema,
]);
export type EvaluationDetails = z.infer<typeof EvaluationDetailsSchema>;

/** What the LLM judge is asked to return (LLM-friendly: flat, no unions). */
export const JudgeOutputSchema = z.object({
  criteria: z.array(
    z.object({
      id: z.string(),
      score: z.number().min(0).max(1),
      reasoning: z.string(),
    }),
  ),
  overallReasoning: z.string(),
});
export type JudgeOutput = z.infer<typeof JudgeOutputSchema>;

/** Weighted worker score. `score` is 0..100, component scores are 0..1 (null = no data for that source). */
export interface WorkerScore {
  score: number | null;
  components: { deterministic: number | null; judge: number | null; user: number | null };
  weightsUsed: { deterministic: number; judge: number; user: number };
  sampleSize: { deterministic: number; judge: number; user: number; runs: number };
}

/** Thresholds that drive Worker.health. */
export const HEALTH_THRESHOLDS = {
  /** Below this score (0..100) the worker Needs Attention. */
  minScore: 65,
  /** Or if this share of the last N finished runs failed. */
  maxRecentFailureRate: 0.4,
  recentRunWindow: 5,
  /** Minimum finished runs before health leaves UNKNOWN. */
  minRunsForHealth: 2,
} as const;

export const KpiActualSchema = z.object({
  kpiId: z.string(),
  name: z.string(),
  metric: z.string(),
  unit: z.string(),
  target: z.number(),
  actual: z.number().nullable(),
  met: z.boolean().nullable(),
  direction: z.enum(["higher_is_better", "lower_is_better"]),
});
export type KpiActual = z.infer<typeof KpiActualSchema>;

/** Stored in WorkerReview.metrics and returned by evaluation.getWorkerMetrics(). */
export const ReviewMetricsSchema = z.object({
  windowDays: z.number(),
  runs: z.number(),
  succeeded: z.number(),
  failed: z.number(),
  successRate: z.number().nullable(),
  deliverables: z.number(),
  accepted: z.number(),
  rejected: z.number(),
  acceptanceRate: z.number().nullable(),
  avgJudgeScore: z.number().nullable(),
  avgDeterministicScore: z.number().nullable(),
  avgRecordsPerRun: z.number().nullable(),
  avgCostPerRunUsd: z.number().nullable(),
  avgDurationSec: z.number().nullable(),
  totalCostUsd: z.number(),
  kpis: z.array(KpiActualSchema),
  /** Chronological per-run combined scores (0..100) for sparkline/trend. */
  scoreTrend: z.array(z.object({ runId: z.string(), at: z.string(), score: z.number() })),
});
export type ReviewMetrics = z.infer<typeof ReviewMetricsSchema>;

/** What the review LLM returns (metrics are computed deterministically, never by the LLM). */
export const ReviewNarrativeSchema = z.object({
  summary: z.string(),
  strengths: z.array(z.string()).max(6),
  problems: z.array(z.string()).max(6),
  recommendation: z.enum(["KEEP", "IMPROVE", "REPLACE"]),
  recommendationDetail: z.string(),
});
export type ReviewNarrative = z.infer<typeof ReviewNarrativeSchema>;
