import { recordActivity } from "@/server/activity";
import type { SessionContext } from "@/server/auth/types";
import { db, toJson } from "@/server/db";
import { HEALTH_THRESHOLDS, ReviewNarrativeSchema, type ReviewNarrative } from "@/server/domain/evaluation";
import { parseJobSpec } from "@/server/domain/job-spec";
import { conflict, notFound } from "@/server/errors";
import { llm } from "@/server/models";
import { DEFAULT_METRICS_WINDOW_DAYS, getWorkerMetrics } from "./metrics";
import { IMPROVE_CEILING, formatKpiValue, mockReviewNarrative, type ReviewEvidence } from "./review-mock";
import { refreshWorkerScore } from "./score";

/**
 * Performance review: metrics and score are computed deterministically; the model only writes the narrative
 * (and picks a recommendation within the same thresholds the simulated reviewer uses).
 */

const MAX_EVIDENCE_ITEMS = 5;
const MAX_LIST_ITEMS = 6;
const DAY_MS = 86_400_000;

const RECOMMENDATION_LABEL: Record<ReviewNarrative["recommendation"], string> = {
  KEEP: "keep",
  IMPROVE: "improve",
  REPLACE: "replace",
};

const REVIEW_SYSTEM = [
  "You are an engagement manager at a staffing agency writing a candid performance review of an AI contractor for the client who hired them.",
  "Every metric you are given was computed from the contractor's actual run history — never invent numbers; quote the ones provided.",
  `Recommendation rules: REPLACE when the quality score is below ${HEALTH_THRESHOLDS.minScore} or more than ${Math.round(HEALTH_THRESHOLDS.maxRecentFailureRate * 100)}% of recent runs failed; IMPROVE when the score is between ${HEALTH_THRESHOLDS.minScore} and ${IMPROVE_CEILING}; KEEP otherwise.`,
  "Write in plain, specific English (\"Accepted 7 of 8 deliverables\"), at most 6 strengths and 6 problems, and quote client feedback on rejected work when it exists.",
].join("\n");

export function buildReviewPrompt(e: ReviewEvidence, objective: string): string {
  const m = e.metrics;
  const lines: string[] = [
    `# Performance review: ${e.workerName} — ${e.jobTitle}`,
    `Objective of the job: ${objective}`,
    `Window: last ${m.windowDays} days`,
    "",
    "## Metrics (computed)",
    `- Runs: ${m.runs} finished (${m.succeeded} succeeded, ${m.failed} failed)${m.successRate !== null ? `; success rate ${Math.round(m.successRate * 100)}%` : ""}`,
    `- Deliverables: ${m.deliverables} (${m.accepted} accepted, ${m.rejected} rejected)${m.acceptanceRate !== null ? `; acceptance rate ${Math.round(m.acceptanceRate * 100)}%` : ""}`,
    `- Quality score: ${e.score.score === null ? "none yet" : `${Math.round(e.score.score)}/100`} (checks ${fmtComponent(e.score.components.deterministic)}, reviewer ${fmtComponent(e.score.components.judge)}, client ${fmtComponent(e.score.components.user)})`,
    `- Average records per run: ${m.avgRecordsPerRun ?? "n/a"}`,
    `- Average cost per run: ${m.avgCostPerRunUsd === null ? "n/a" : formatKpiValue(m.avgCostPerRunUsd, "$")}; total ${formatKpiValue(m.totalCostUsd, "$")}`,
    `- Average active duration: ${m.avgDurationSec === null ? "n/a" : formatKpiValue(m.avgDurationSec, "sec")}`,
  ];
  if (m.kpis.length > 0) {
    lines.push("", "## KPIs");
    for (const k of m.kpis) {
      const actual = k.actual === null ? "n/a" : formatKpiValue(k.actual, k.unit);
      const status = k.met === null ? "no data" : k.met ? "met" : "missed";
      lines.push(`- ${k.name}: ${actual} vs target ${formatKpiValue(k.target, k.unit)} (${k.direction === "higher_is_better" ? "higher is better" : "lower is better"}) — ${status}`);
    }
  }
  if (m.scoreTrend.length > 0) {
    lines.push("", `## Score trend (oldest → newest): ${m.scoreTrend.map((p) => Math.round(p.score)).join(", ")}`);
  }
  if (e.failedRunErrors.length > 0) {
    lines.push("", "## Failed runs (most recent first)", ...e.failedRunErrors.map((err) => `- ${err}`));
  }
  if (e.rejectedFeedback.length > 0) {
    lines.push("", "## Client feedback on rejected deliverables", ...e.rejectedFeedback.map((f) => `- “${f.title}”: ${f.feedback}`));
  }
  return lines.join("\n");
}

function fmtComponent(value: number | null): string {
  return value === null ? "n/a" : `${Math.round(value * 100)}/100`;
}

/** Providers ignore array maxima and casing; clamp before validation so a chatty model still yields a review. */
export function normalizeReviewNarrative(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const input = raw as Record<string, unknown>;
  const list = (value: unknown) =>
    (Array.isArray(value) ? value : [])
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0)
      .slice(0, MAX_LIST_ITEMS);
  return {
    ...input,
    strengths: list(input.strengths),
    problems: list(input.problems),
    recommendation: typeof input.recommendation === "string" ? input.recommendation.trim().toUpperCase() : input.recommendation,
  };
}

export async function generatePerformanceReview(s: SessionContext, workerId: string): Promise<{ reviewId: string }> {
  const worker = await db.worker.findFirst({
    where: { id: workerId, organizationId: s.organizationId },
    select: {
      id: true,
      name: true,
      jobId: true,
      currentVersionId: true,
      job: { select: { title: true } },
      currentVersion: { select: { id: true, jobSpec: { select: { spec: true } } } },
    },
  });
  if (!worker) throw notFound("Worker");
  if (!worker.currentVersionId || !worker.currentVersion) throw conflict(`${worker.name} has no active version to review`);

  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - DEFAULT_METRICS_WINDOW_DAYS * DAY_MS);
  const versionId = worker.currentVersion.id;

  // WorkerReview.overallScore is a number: storing 0 for "not rated yet" would show a brand-new (or just
  // replaced) worker as a 0/100 failure next to a KEEP recommendation. No evaluated run → no review yet.
  const score = await refreshWorkerScore(worker.id);
  if (score.score === null) {
    throw conflict(`${worker.name} has no evaluated runs yet — a performance review needs at least one finished run that has been scored`);
  }
  const overallScore = score.score;

  const [metrics, rejected, failedRuns] = await Promise.all([
    getWorkerMetrics(s.organizationId, worker.id, { windowDays: DEFAULT_METRICS_WINDOW_DAYS, workerVersionId: versionId }),
    db.deliverable.findMany({
      where: {
        organizationId: s.organizationId,
        workerId: worker.id,
        workerVersionId: versionId,
        status: "REJECTED",
        createdAt: { gte: periodStart },
        feedback: { not: null },
      },
      orderBy: { reviewedAt: "desc" },
      take: MAX_EVIDENCE_ITEMS,
      select: { title: true, feedback: true },
    }),
    db.run.findMany({
      where: { organizationId: s.organizationId, workerId: worker.id, workerVersionId: versionId, status: "FAILED", createdAt: { gte: periodStart } },
      orderBy: { createdAt: "desc" },
      take: MAX_EVIDENCE_ITEMS,
      select: { error: true },
    }),
  ]);

  const evidence: ReviewEvidence = {
    workerName: worker.name,
    jobTitle: worker.job.title,
    metrics,
    score,
    rejectedFeedback: rejected.flatMap((d) => (d.feedback?.trim() ? [{ title: d.title, feedback: d.feedback.trim() }] : [])),
    failedRunErrors: failedRuns.map((r) => r.error?.trim() || "unknown error"),
  };
  const objective = parseJobSpec(worker.currentVersion.jobSpec.spec).objective;

  const result = await llm.generateObject(
    {
      tier: "standard",
      system: REVIEW_SYSTEM,
      prompt: buildReviewPrompt(evidence, objective),
      schema: ReviewNarrativeSchema,
      schemaName: "ReviewNarrative",
      normalize: normalizeReviewNarrative,
      mock: () => mockReviewNarrative(evidence),
    },
    { organizationId: s.organizationId, workerId: worker.id, jobId: worker.jobId, purpose: "review.narrative" },
  );
  const narrative = result.object;

  const review = await db.workerReview.create({
    data: {
      organizationId: s.organizationId,
      workerId: worker.id,
      workerVersionId: versionId,
      periodStart,
      periodEnd,
      overallScore,
      summary: narrative.summary,
      strengths: toJson(narrative.strengths),
      problems: toJson(narrative.problems),
      recommendation: narrative.recommendation,
      recommendationDetail: narrative.recommendationDetail,
      metrics: toJson(metrics),
      requestedById: s.userId,
    },
    select: { id: true },
  });

  await recordActivity({
    organizationId: s.organizationId,
    type: "REVIEW_GENERATED",
    title: `${s.name} reviewed ${worker.name}’s performance — recommendation: ${RECOMMENDATION_LABEL[narrative.recommendation]}`,
    // The score is computed over the most recent finished runs (not the metrics' day window), so say so.
    detail: `Score ${Math.round(overallScore)}/100 over the last ${score.sampleSize.runs} finished run${score.sampleSize.runs === 1 ? "" : "s"}`,
    workerId: worker.id,
    jobId: worker.jobId,
    actorType: "USER",
    actorName: s.name,
    metadata: { reviewId: review.id, recommendation: narrative.recommendation },
  });

  return { reviewId: review.id };
}
