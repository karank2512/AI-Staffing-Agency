import { recordActivity } from "@/server/activity";
import { db, toJson } from "@/server/db";
import { evaluateRun, refreshWorkerScore } from "@/server/evaluation";
import { errorMessage } from "@/server/errors";
import { oneLine } from "./compact";
import { RunFailure } from "./failure";
import { log } from "./log";
import type { RunSlice } from "./slice";
import type { ExecuteOutcome, RunOutput } from "./types";

/** Terminal transitions of a slice: success (with evaluation) and failure (retry with backoff, or final). */

const RETRY_BACKOFF_MS = 15_000;
const usd = (n: number) => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

export async function finishSuccess(slice: RunSlice): Promise<ExecuteOutcome> {
  const { run } = slice;
  const deliverables = await db.deliverable.findMany({
    where: { runId: run.id, organizationId: run.organizationId },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, data: true },
  });
  if (deliverables.length === 0) {
    // The blueprint schema guarantees the content key is produced, so this means a component emitted nothing.
    throw new RunFailure("VALIDATION", `No deliverable was produced: the context key "${slice.blueprint.deliverable.contentKey}" is empty`, false);
  }
  const [first] = deliverables;
  const records = Array.isArray(first.data) ? first.data.length : null;

  const [steps, modelCalls, toolCalls, costRow] = await Promise.all([
    db.runStep.count({ where: { runId: run.id } }),
    db.modelCall.count({ where: { runId: run.id } }),
    db.toolCall.count({ where: { runId: run.id } }),
    db.run.findUnique({ where: { id: run.id }, select: { costUsd: true } }),
  ]);
  const output: RunOutput = {
    summary: `Produced “${first.title}”${records !== null ? ` (${plural(records, "record")})` : ""} in ${plural(steps, "step")}`,
    deliverableIds: deliverables.map((d) => d.id),
    stats: { steps, modelCalls, toolCalls },
  };
  const checkpoint = slice.snapshot();
  const activeMs = checkpoint.counters.activeMs;
  await slice.lock.transition("SUCCEEDED", { output: toJson(output), checkpoint: toJson(checkpoint), durationMs: activeMs, finishedAt: new Date(), error: null });
  log.info(`run ${run.id} succeeded: ${output.summary}`);

  // Evaluation never fails a run that already succeeded; its step records what happened either way. It runs
  // after the terminal transition (the lease is released), so it is the one step finished without the fence.
  const evalStep = await slice.steps.begin({ kind: "EVALUATION", title: "Evaluating the deliverable", input: { deliverableId: first.id } });
  try {
    const result = await evaluateRun(run.id);
    const parts: string[] = [];
    if (result.deterministic) parts.push(`Checks ${Math.round(result.deterministic.score * 100)}/100`);
    if (result.judge) parts.push(`Reviewer ${Math.round(result.judge.score * 100)}/100`);
    await slice.steps.finishAfterRelease(evalStep, {
      status: "SUCCEEDED",
      detail: parts.join(" · ") || "Nothing to evaluate",
      output: { deterministic: result.deterministic?.score ?? null, judge: result.judge?.score ?? null },
    });
  } catch (e) {
    log.error(`evaluation of run ${run.id} failed`, e);
    await slice.steps.finishAfterRelease(evalStep, { status: "FAILED", error: errorMessage(e) });
  }

  await db.worker.updateMany({ where: { id: run.workerId, organizationId: run.organizationId }, data: { lastRunAt: new Date() } });
  const detail = [`Delivered “${first.title}”`];
  if (records !== null) detail.push(plural(records, "record"));
  detail.push(plural(steps, "step"), usd(Number(costRow?.costUsd ?? 0)));
  await recordActivity({
    organizationId: run.organizationId,
    type: "RUN_SUCCEEDED",
    title: `${slice.workerName} finished a run`,
    detail: detail.join(" · "),
    workerId: run.workerId,
    jobId: run.jobId,
    runId: run.id,
    actorType: "WORKER",
    actorName: slice.workerName,
    metadata: { deliverableId: first.id },
  });
  return { status: "SUCCEEDED", deliverableIds: output.deliverableIds };
}

export async function finishFailure(slice: RunSlice, failure: RunFailure): Promise<ExecuteOutcome> {
  const { run, cp } = slice;
  const message = oneLine(failure.message, 1_000);
  await slice.steps.record({
    kind: "ERROR",
    title: message,
    status: "FAILED",
    error: failure.message,
    componentId: slice.blueprint.components[slice.componentStart.index]?.id,
    output: { code: failure.code, retryable: failure.retryable, attempt: run.attempt, maxAttempts: run.maxAttempts },
  });

  const willRetry = failure.retryable && run.attempt < run.maxAttempts;
  if (willRetry) {
    // Restart the failed component from its own beginning; the step index keeps counting up.
    cp.componentIndex = slice.componentStart.index;
    cp.context = slice.componentStart.context;
    cp.agent = undefined;
    await slice.lock.transition("QUEUED", {
      attempt: run.attempt + 1,
      availableAt: new Date(Date.now() + RETRY_BACKOFF_MS * run.attempt),
      error: message,
      checkpoint: toJson(slice.snapshot()),
    });
    log.warn(`run ${run.id} failed on attempt ${run.attempt}/${run.maxAttempts}, retrying: ${message}`);
    return { status: "FAILED", error: message, willRetry: true };
  }

  const checkpoint = slice.snapshot();
  await slice.lock.transition("FAILED", { error: message, checkpoint: toJson(checkpoint), durationMs: checkpoint.counters.activeMs, finishedAt: new Date() });
  log.warn(`run ${run.id} failed (${failure.code}): ${message}`);
  try {
    await refreshWorkerScore(run.workerId);
  } catch (e) {
    log.error(`could not refresh the score of worker ${run.workerId}`, e);
  }
  await recordActivity({
    organizationId: run.organizationId,
    type: "RUN_FAILED",
    title: `${slice.workerName} could not finish a run`,
    detail: message,
    workerId: run.workerId,
    jobId: run.jobId,
    runId: run.id,
    actorType: "WORKER",
    actorName: slice.workerName,
  });
  return { status: "FAILED", error: message, willRetry: false };
}
