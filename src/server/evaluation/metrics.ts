import { db } from "@/server/db";
import { safeParseBlueprint, type Kpi } from "@/server/domain/blueprint";
import type { KpiActual, ReviewMetrics } from "@/server/domain/evaluation";
import { notFound } from "@/server/errors";
import { asRecords } from "./records";
import { runScore, weightsOfBlueprint, type EvaluationPart } from "./score";

/**
 * Deterministic performance metrics for one worker over a rolling window — the numbers behind the Performance
 * tab, KPI cards and every performance review. Nothing here is estimated by a model.
 *
 * Scope: the runs/deliverables of ONE version (the current one unless `workerVersionId` is given), matching how
 * the worker score resets when a replacement is hired — a new version starts with a clean record.
 */

export const DEFAULT_METRICS_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 365;
const DAY_MS = 86_400_000;

const round = (n: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};
const mean = (values: readonly number[]) => (values.length === 0 ? null : values.reduce((s, v) => s + v, 0) / values.length);
const ratio = (numerator: number, denominator: number) => (denominator === 0 ? null : round(numerator / denominator, 4));

type Rates = Pick<
  ReviewMetrics,
  "successRate" | "acceptanceRate" | "avgJudgeScore" | "avgRecordsPerRun" | "avgCostPerRunUsd" | "avgDurationSec"
>;

/** Map a KPI's metric onto the computed value (KPI_METRICS semantics) and decide whether the target is met. */
export function kpiActual(kpi: Kpi, rates: Rates): KpiActual {
  const actual =
    kpi.metric === "success_rate"
      ? rates.successRate
      : kpi.metric === "acceptance_rate"
        ? rates.acceptanceRate
        : kpi.metric === "quality_score"
          ? rates.avgJudgeScore
          : kpi.metric === "records_per_run"
            ? rates.avgRecordsPerRun
            : kpi.metric === "cost_per_run_usd"
              ? rates.avgCostPerRunUsd
              : rates.avgDurationSec;
  return {
    kpiId: kpi.id,
    name: kpi.name,
    metric: kpi.metric,
    unit: kpi.unit,
    target: kpi.target,
    direction: kpi.direction,
    actual,
    met: actual === null ? null : kpi.direction === "higher_is_better" ? actual >= kpi.target : actual <= kpi.target,
  };
}

export function emptyMetrics(windowDays: number, kpis: readonly Kpi[] = []): ReviewMetrics {
  const rates: Rates = {
    successRate: null,
    acceptanceRate: null,
    avgJudgeScore: null,
    avgRecordsPerRun: null,
    avgCostPerRunUsd: null,
    avgDurationSec: null,
  };
  return {
    windowDays,
    runs: 0,
    succeeded: 0,
    failed: 0,
    deliverables: 0,
    accepted: 0,
    rejected: 0,
    ...rates,
    avgDeterministicScore: null,
    totalCostUsd: 0,
    kpis: kpis.map((k) => kpiActual(k, rates)),
    scoreTrend: [],
  };
}

export async function getWorkerMetrics(
  organizationId: string,
  workerId: string,
  opts: { windowDays?: number; workerVersionId?: string } = {},
): Promise<ReviewMetrics> {
  const worker = await db.worker.findFirst({
    where: { id: workerId, organizationId },
    select: { id: true, currentVersionId: true },
  });
  if (!worker) throw notFound("Worker");

  const windowDays = Math.min(MAX_WINDOW_DAYS, Math.max(1, Math.floor(opts.windowDays ?? DEFAULT_METRICS_WINDOW_DAYS)));
  const since = new Date(Date.now() - windowDays * DAY_MS);

  const versionId = opts.workerVersionId ?? worker.currentVersionId;
  if (!versionId) return emptyMetrics(windowDays);
  const version = await db.workerVersion.findFirst({ where: { id: versionId, workerId: worker.id }, select: { blueprint: true } });
  if (!version) throw notFound("Worker version");
  const parsed = safeParseBlueprint(version.blueprint);
  const kpis = parsed.success ? parsed.data.kpis : [];
  const weights = weightsOfBlueprint(version.blueprint);

  const scope = { organizationId, workerId: worker.id, workerVersionId: versionId, createdAt: { gte: since } };
  const [runs, deliverables] = await Promise.all([
    db.run.findMany({
      where: { ...scope, status: { in: ["SUCCEEDED", "FAILED"] } },
      orderBy: [{ finishedAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      select: { id: true, status: true, costUsd: true, durationMs: true, finishedAt: true, createdAt: true },
    }),
    db.deliverable.findMany({ where: scope, select: { status: true, data: true } }),
  ]);
  const evaluations =
    runs.length === 0
      ? []
      : await db.evaluation.findMany({
          where: { organizationId, workerId: worker.id, runId: { in: runs.map((r) => r.id) } },
          select: { runId: true, type: true, score: true },
        });

  const succeeded = runs.filter((r) => r.status === "SUCCEEDED").length;
  const failed = runs.length - succeeded;
  const accepted = deliverables.filter((d) => d.status === "ACCEPTED").length;
  const rejected = deliverables.filter((d) => d.status === "REJECTED").length;

  const costs = runs.map((r) => Number(r.costUsd));
  const durations = runs.flatMap((r) => (typeof r.durationMs === "number" ? [r.durationMs / 1000] : []));
  const recordCounts = deliverables.flatMap((d) => {
    const records = asRecords(d.data);
    return records ? [records.length] : [];
  });
  const judgeScores = evaluations.filter((e) => e.type === "LLM_JUDGE").map((e) => e.score);
  const checkScores = evaluations.filter((e) => e.type === "DETERMINISTIC").map((e) => e.score);

  const avgCost = mean(costs);
  const avgDuration = mean(durations);
  const avgRecords = mean(recordCounts);
  const avgJudge = mean(judgeScores);
  const avgChecks = mean(checkScores);
  const rates: Rates = {
    successRate: ratio(succeeded, runs.length),
    acceptanceRate: ratio(accepted, accepted + rejected),
    avgJudgeScore: avgJudge === null ? null : round(avgJudge, 4),
    avgRecordsPerRun: avgRecords === null ? null : round(avgRecords, 1),
    avgCostPerRunUsd: avgCost === null ? null : round(avgCost, 4),
    avgDurationSec: avgDuration === null ? null : round(avgDuration, 1),
  };

  const evaluationsByRun = new Map<string, EvaluationPart[]>();
  for (const e of evaluations) {
    if (!e.runId) continue;
    const list = evaluationsByRun.get(e.runId) ?? [];
    list.push({ type: e.type, score: e.score });
    evaluationsByRun.set(e.runId, list);
  }
  const scoreTrend: ReviewMetrics["scoreTrend"] = [];
  for (const run of runs) {
    const score = runScore(run.status, evaluationsByRun.get(run.id) ?? [], weights);
    if (score !== null) scoreTrend.push({ runId: run.id, at: (run.finishedAt ?? run.createdAt).toISOString(), score });
  }

  return {
    windowDays,
    runs: runs.length,
    succeeded,
    failed,
    deliverables: deliverables.length,
    accepted,
    rejected,
    ...rates,
    avgDeterministicScore: avgChecks === null ? null : round(avgChecks, 4),
    totalCostUsd: round(costs.reduce((s, c) => s + c, 0), 4),
    kpis: kpis.map((k) => kpiActual(k, rates)),
    scoreTrend,
  };
}
