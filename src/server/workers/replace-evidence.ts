import type { EvaluationType } from "@prisma/client";
import { db } from "@/server/db";
import { DETERMINISTIC_CHECK_CONFIG_SCHEMAS, EvaluationDetailsSchema, type KpiActual, type ReviewMetrics, type WorkerBlueprint } from "@/server/domain";
import { getWorkerMetrics } from "@/server/evaluation";
import { oneLine } from "./shared";

/**
 * The case for replacing a worker, gathered from the current version's record over a rolling window: failed
 * runs and their errors, evaluations below the pass mark and why, deliverables the manager sent back (with what
 * they said), record shortfalls and missed KPIs. Both the live prompt and the simulated plan read this.
 */

export const REPLACEMENT_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;
const MAX_ITEMS = 12;

export interface FailedRunEvidence {
  runId: string;
  error: string;
  at: string;
}

export interface LowEvaluationEvidence {
  type: EvaluationType;
  /** 0..1 */
  score: number;
  reasoning: string;
  at: string;
}

export interface RejectedDeliverableEvidence {
  deliverableId: string;
  title: string;
  feedback: string | null;
  at: string;
}

export interface ReplacementEvidence {
  windowDays: number;
  workerName: string;
  jobTitle: string;
  runs: number;
  succeeded: number;
  failed: number;
  /** Most recent first. */
  failedRuns: FailedRunEvidence[];
  /** Every evaluation of the version in the window (the denominator shown on the analysis). */
  evaluations: number;
  lowEvaluations: LowEvaluationEvidence[];
  rejectedDeliverables: RejectedDeliverableEvidence[];
  /** Deliverables whose record count fell under the blueprint's min_records check. */
  recordShortfalls: { min: number | null; withRecords: number; short: number; averageRecords: number | null };
  kpiMisses: KpiActual[];
  metrics: ReviewMetrics;
  passThreshold: number;
}

function minRecordsOf(blueprint: WorkerBlueprint): number | null {
  const check = blueprint.evaluation.deterministicChecks.find((c) => c.type === "min_records");
  if (!check) return null;
  const parsed = DETERMINISTIC_CHECK_CONFIG_SCHEMAS.min_records.safeParse(check.config);
  return parsed.success ? parsed.data.min : null;
}

/** Why an evaluation fell short, in the evaluator's own words. */
function reasoningOf(details: unknown, summary: string | null): string {
  const parsed = EvaluationDetailsSchema.safeParse(details);
  if (parsed.success) {
    const d = parsed.data;
    if (d.kind === "llm_judge") return oneLine(d.overallReasoning);
    if (d.kind === "deterministic") {
      const failing = d.checks.filter((c) => !c.passed).map((c) => `${c.description}: ${c.observed} (expected ${c.expected})`);
      if (failing.length > 0) return failing.join("; ");
    }
    if (d.kind === "user_feedback" && d.feedback) return oneLine(d.feedback);
  }
  return summary ? oneLine(summary) : "no reasoning recorded";
}

export async function gatherEvidence(args: {
  organizationId: string;
  workerId: string;
  versionId: string;
  blueprint: WorkerBlueprint;
  workerName: string;
  jobTitle: string;
  windowDays?: number;
}): Promise<ReplacementEvidence> {
  const windowDays = args.windowDays ?? REPLACEMENT_WINDOW_DAYS;
  const since = new Date(Date.now() - windowDays * DAY_MS);
  const scope = { organizationId: args.organizationId, workerId: args.workerId, workerVersionId: args.versionId, createdAt: { gte: since } };
  const passThreshold = args.blueprint.evaluation.passThreshold;

  const [runs, evaluations, deliverables, metrics] = await Promise.all([
    db.run.findMany({
      where: { ...scope, status: { in: ["SUCCEEDED", "FAILED"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, error: true, finishedAt: true, createdAt: true },
    }),
    db.evaluation.findMany({
      where: scope,
      orderBy: { createdAt: "desc" },
      select: { type: true, score: true, details: true, summary: true, createdAt: true },
    }),
    db.deliverable.findMany({
      where: scope,
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, status: true, feedback: true, data: true, createdAt: true },
    }),
    getWorkerMetrics(args.organizationId, args.workerId, { windowDays, workerVersionId: args.versionId }),
  ]);

  const failedRuns = runs
    .filter((r) => r.status === "FAILED")
    .slice(0, MAX_ITEMS)
    .map((r) => ({ runId: r.id, error: oneLine(r.error ?? "") || "no error message recorded", at: (r.finishedAt ?? r.createdAt).toISOString() }));

  const lowEvaluations = evaluations
    .filter((e) => e.score < passThreshold)
    .slice(0, MAX_ITEMS)
    .map((e) => ({ type: e.type, score: e.score, reasoning: reasoningOf(e.details, e.summary), at: e.createdAt.toISOString() }));

  const rejectedDeliverables = deliverables
    .filter((d) => d.status === "REJECTED")
    .slice(0, MAX_ITEMS)
    .map((d) => ({ deliverableId: d.id, title: d.title, feedback: d.feedback ? oneLine(d.feedback) : null, at: d.createdAt.toISOString() }));

  const counts = deliverables.flatMap((d) => (Array.isArray(d.data) ? [d.data.length] : []));
  const min = minRecordsOf(args.blueprint);
  const recordShortfalls = {
    min,
    withRecords: counts.length,
    short: min === null ? 0 : counts.filter((n) => n < min).length,
    averageRecords: counts.length > 0 ? Math.round((counts.reduce((s, n) => s + n, 0) / counts.length) * 10) / 10 : null,
  };

  return {
    windowDays,
    workerName: args.workerName,
    jobTitle: args.jobTitle,
    runs: runs.length,
    succeeded: runs.filter((r) => r.status === "SUCCEEDED").length,
    failed: runs.filter((r) => r.status === "FAILED").length,
    failedRuns,
    evaluations: evaluations.length,
    lowEvaluations,
    rejectedDeliverables,
    recordShortfalls,
    kpiMisses: metrics.kpis.filter((k) => k.met === false),
    metrics,
    passThreshold,
  };
}
