import type { Evaluation, EvaluationType } from "@prisma/client";
import { recordActivity } from "@/server/activity";
import { db, toJson } from "@/server/db";
import { parseBlueprint } from "@/server/domain/blueprint";
import { fromDbDeliverableFormat } from "@/server/domain/db-mapping";
import type { EvaluationDetails } from "@/server/domain/evaluation";
import { parseJobSpec, type DeliverableFormatSlug } from "@/server/domain/job-spec";
import { errorMessage, notFound } from "@/server/errors";
import { runDeterministicChecks } from "./deterministic";
import { judgeDeliverable } from "./judge";
import { asRecords } from "./records";
import { combineScores, partsFromEvaluations, refreshWorkerScore } from "./score";
import type { EvalSubject } from "./types";

/**
 * Evaluate one run's deliverable: deterministic checks + LLM judge, each upserted on (deliverableId, type) so
 * calling this twice is harmless. Then the worker's cached score/health are refreshed and the feed gets one
 * "scored N/100" line. The runtime wraps this in its EVALUATION step; a failure here never fails the run.
 */

const SUMMARY_MAX_CHARS = 280;

const DELIVERABLE_NOUN: Record<DeliverableFormatSlug, string> = {
  markdown: "report",
  csv: "CSV export",
  json: "JSON export",
};

function clip(text: string, max = SUMMARY_MAX_CHARS): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

const pct = (score: number) => Math.round(score * 100);

interface UpsertArgs {
  organizationId: string;
  workerId: string;
  workerVersionId: string;
  runId: string;
  deliverableId: string;
  type: EvaluationType;
  score: number;
  passed: boolean;
  summary: string;
  details: EvaluationDetails;
}

function upsertEvaluation(args: UpsertArgs): Promise<Evaluation> {
  const { deliverableId, type, ...rest } = args;
  const data = { ...rest, details: toJson(args.details) };
  return db.evaluation.upsert({
    where: { deliverableId_type: { deliverableId, type } },
    create: { deliverableId, type, ...data },
    update: data,
  });
}

export async function evaluateRun(runId: string): Promise<{ deterministic: Evaluation | null; judge: Evaluation | null }> {
  const run = await db.run.findUnique({
    where: { id: runId },
    select: {
      id: true,
      organizationId: true,
      jobId: true,
      workerId: true,
      workerVersionId: true,
      costUsd: true,
      durationMs: true,
      worker: { select: { name: true } },
      workerVersion: { select: { blueprint: true, jobSpec: { select: { spec: true } } } },
      deliverables: { orderBy: { createdAt: "asc" }, take: 1 },
    },
  });
  if (!run) throw notFound("Run");

  const deliverable = run.deliverables[0];
  if (!deliverable) return { deterministic: null, judge: null };

  const blueprint = parseBlueprint(run.workerVersion.blueprint);
  const spec = parseJobSpec(run.workerVersion.jobSpec.spec);
  const plan = blueprint.evaluation;

  const subject: EvalSubject = {
    content: deliverable.content,
    format: fromDbDeliverableFormat(deliverable.format),
    records: asRecords(deliverable.data),
    costUsd: Number(run.costUsd),
    durationSec: (run.durationMs ?? 0) / 1000,
  };
  const ids = {
    organizationId: run.organizationId,
    workerId: run.workerId,
    workerVersionId: run.workerVersionId,
    runId: run.id,
    deliverableId: deliverable.id,
  };

  const checks = runDeterministicChecks(plan, subject);
  const passedChecks = checks.checks.filter((c) => c.passed).length;
  const deterministic = await upsertEvaluation({
    ...ids,
    type: "DETERMINISTIC",
    score: checks.score,
    passed: checks.passed,
    summary:
      checks.checks.length === 0
        ? "No automated checks configured"
        : `${passedChecks} of ${checks.checks.length} checks passed (${pct(checks.score)}/100)`,
    details: { kind: "deterministic", checks: checks.checks },
  });

  let judge: Evaluation | null = null;
  try {
    const verdict = await judgeDeliverable(
      { spec, plan, subject, deliverableTitle: deliverable.title },
      { organizationId: run.organizationId, workerId: run.workerId, jobId: run.jobId, runId: run.id, purpose: "evaluation.judge" },
    );
    judge = await upsertEvaluation({
      ...ids,
      type: "LLM_JUDGE",
      score: verdict.score,
      passed: verdict.passed,
      summary: clip(verdict.overallReasoning) || `Rated ${pct(verdict.score)}/100 by the reviewer`,
      details: {
        kind: "llm_judge",
        criteria: verdict.criteria,
        overallReasoning: verdict.overallReasoning,
        model: verdict.model,
        simulated: verdict.simulated,
      },
    });
  } catch (e) {
    // The deterministic verdict is already saved; a judge outage must not hide it or fail the run.
    console.error(`[evaluation] judge failed for run ${run.id}: ${errorMessage(e)}`);
  }

  await refreshWorkerScore(run.workerId);

  // The headline number is this run's own blend (user feedback may already exist when re-evaluating).
  const rows = await db.evaluation.findMany({
    where: { organizationId: run.organizationId, runId: run.id },
    select: { type: true, score: true },
  });
  const runBlend = combineScores(partsFromEvaluations(rows), plan.weights, 1).score ?? checks.score * 100;
  const noun = DELIVERABLE_NOUN[subject.format];
  const detailParts = [`Checks ${pct(checks.score)}/100`];
  if (judge) detailParts.push(`Reviewer ${pct(judge.score)}/100`);
  else detailParts.push("Reviewer unavailable");
  if (checks.checks.length > 0) detailParts.push(`${passedChecks} of ${checks.checks.length} checks passed`);

  await recordActivity({
    organizationId: run.organizationId,
    type: "EVALUATION_COMPLETED",
    title: `${run.worker.name}’s ${noun} scored ${Math.round(runBlend)}/100`,
    detail: detailParts.join(" · "),
    workerId: run.workerId,
    jobId: run.jobId,
    runId: run.id,
    actorType: "SYSTEM",
    metadata: { deliverableId: deliverable.id },
  });

  return { deterministic, judge };
}
