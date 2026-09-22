import type { RunTrigger } from "@prisma/client";
import { recordActivity } from "@/server/activity";
import type { SessionContext } from "@/server/auth/types";
import { config } from "@/server/config";
import { db, toJson } from "@/server/db";
import { refreshWorkerScore } from "@/server/evaluation";
import { conflict, notFound } from "@/server/errors";
import { llm } from "@/server/models";
import { parseCheckpoint } from "./checkpoint";
import { WORKER_RETIRED_REASON } from "./failure";
import { log } from "./log";
import { sweepOrphanedRuns } from "./orphans";
import { closeOpenWork } from "./transitions";
import { RunInputSchema, type EnqueueRunArgs } from "./types";

/** Durable queue: enqueue, atomic claim, stale-lease recovery and manual retry. */

const STALE_RETRY_MESSAGE = "The executor stopped responding mid-run; the run was re-queued";
const STALE_FINAL_MESSAGE = "The executor stopped responding mid-run and no attempts remain";

function queuedTitle(trigger: RunTrigger, name: string): string {
  switch (trigger) {
    case "MANUAL":
      return `${name} was asked to run now`;
    case "SCHEDULED":
      return `${name}’s scheduled run was queued`;
    case "RETRY":
      return `${name} was asked to try again`;
    case "CHAT":
      return `${name} was asked to run from a chat message`;
    case "HIRE":
      return `${name}’s first run was queued`;
  }
}

export async function enqueueRun(args: EnqueueRunArgs): Promise<{ runId: string }> {
  const { organizationId, workerId } = args;
  const now = new Date();

  const created = await db.$transaction(async (tx) => {
    const worker = await tx.worker.findFirst({
      where: { id: workerId, organizationId },
      select: { id: true, name: true, jobId: true, status: true, currentVersionId: true, job: { select: { title: true } } },
    });
    if (!worker) throw notFound("Worker");
    if (worker.status !== "ACTIVE") throw conflict(`${worker.name} is ${worker.status.toLowerCase()} and cannot take on a run`);
    if (!worker.currentVersionId) throw conflict(`${worker.name} has no active version to run`);
    const version = await tx.workerVersion.findFirst({ where: { id: worker.currentVersionId, workerId: worker.id }, select: { id: true } });
    if (!version) throw conflict(`${worker.name} has no active version to run`);

    // First run locks the version forever (rule 5: WorkerVersions are immutable once lockedAt is set).
    await tx.workerVersion.updateMany({ where: { id: version.id, lockedAt: null }, data: { lockedAt: now } });

    const pendingInstructions = await tx.workerMessage.findMany({
      where: { organizationId, workerId: worker.id, classification: "TEMPORARY_INSTRUCTION", instructionActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, content: true },
    });
    // De-duplicated: a retry of a cancelled run carries its instructions AND gets them back from the messages.
    const instructions = [...(args.input?.instructions ?? []), ...pendingInstructions.map((m) => m.content.trim())].filter((s) => s.length > 0);
    const input = RunInputSchema.parse({ ...args.input, instructions: [...new Set(instructions)] });

    const run = await tx.run.create({
      data: {
        organizationId,
        jobId: worker.jobId,
        workerId: worker.id,
        workerVersionId: version.id,
        status: "QUEUED",
        trigger: args.trigger,
        input: toJson(input),
        simulated: llm.isSimulated(),
        requestedById: args.requestedById ?? null,
        availableAt: args.availableAt ?? now,
      },
      select: { id: true },
    });
    if (pendingInstructions.length > 0) {
      await tx.workerMessage.updateMany({
        where: { id: { in: pendingInstructions.map((m) => m.id) } },
        data: { instructionActive: false, appliedToRunId: run.id },
      });
    }
    return { runId: run.id, worker, instructions: input.instructions.length };
  });

  const requester = args.requestedById
    ? await db.user.findFirst({ where: { id: args.requestedById, organizationId }, select: { name: true } })
    : null;
  const details = [created.worker.job.title];
  if (created.instructions > 0) details.push(`${created.instructions} one-off instruction${created.instructions === 1 ? "" : "s"}`);
  await recordActivity({
    organizationId,
    type: "RUN_QUEUED",
    title: queuedTitle(args.trigger, created.worker.name),
    detail: details.join(" · "),
    workerId: created.worker.id,
    jobId: created.worker.jobId,
    runId: created.runId,
    actorType: requester ? "USER" : "SYSTEM",
    actorName: requester?.name,
  });
  return { runId: created.runId };
}

export interface ClaimCandidate {
  id: string;
  organizationId: string;
  workerId: string;
  jobId: string;
  startedAt: Date | null;
  worker: { name: string };
}

export const CLAIM_SELECT = {
  id: true,
  organizationId: true,
  workerId: true,
  jobId: true,
  startedAt: true,
  worker: { select: { name: true } },
} as const;

/**
 * Guarded QUEUED → RUNNING for one run. Returns false when someone else moved it first. Shared by the executor's
 * claimNextRun and by executeRun's inline claim so both stamp the lease identically.
 */
export async function claimRun(run: ClaimCandidate, executorId: string): Promise<boolean> {
  const now = new Date();
  const result = await db.run.updateMany({
    where: { id: run.id, status: "QUEUED" },
    data: {
      status: "RUNNING",
      lockedBy: executorId,
      lockedAt: now,
      heartbeatAt: now,
      ...(run.startedAt ? {} : { startedAt: now }),
    },
  });
  if (result.count !== 1) return false;
  if (!run.startedAt) {
    // Only the very first start makes the feed; retries and approval resumes are continuations of the same run.
    await recordActivity({
      organizationId: run.organizationId,
      type: "RUN_STARTED",
      title: `${run.worker.name} started working`,
      workerId: run.workerId,
      jobId: run.jobId,
      runId: run.id,
      actorType: "WORKER",
      actorName: run.worker.name,
    });
  }
  return true;
}

export async function claimNextRun(executorId: string, opts: { organizationId?: string } = {}): Promise<string | null> {
  // A candidate can be taken by another executor between the read and the guarded write: loop until a write lands.
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = await db.run.findFirst({
      where: {
        status: "QUEUED",
        availableAt: { lte: new Date() },
        worker: { status: "ACTIVE" },
        ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
      },
      orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
      select: CLAIM_SELECT,
    });
    if (!candidate) return null;
    if (await claimRun(candidate, executorId)) return candidate.id;
  }
  return null;
}

/**
 * RUNNING runs whose heartbeat is older than staleLockMs belong to a dead executor. Each one is re-queued for its
 * next attempt (or failed when none remain) with a guard on the exact stale heartbeat, so a live executor that
 * heartbeats in between keeps its run.
 */
export async function recoverStaleRuns(opts: { organizationId?: string } = {}): Promise<number> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - config.executor.staleLockMs);
  const stale = await db.run.findMany({
    where: {
      status: "RUNNING",
      ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
      OR: [
        { heartbeatAt: { lt: staleBefore } },
        { heartbeatAt: null, lockedAt: { lt: staleBefore } },
        { heartbeatAt: null, lockedAt: null, updatedAt: { lt: staleBefore } },
      ],
    },
    select: {
      id: true,
      organizationId: true,
      workerId: true,
      jobId: true,
      attempt: true,
      maxAttempts: true,
      heartbeatAt: true,
      checkpoint: true,
      worker: { select: { name: true, status: true } },
    },
  });

  let recovered = 0;
  for (const run of stale) {
    const guard = { id: run.id, status: "RUNNING" as const, heartbeatAt: run.heartbeatAt };
    if (run.worker.status === "RETIRED") {
      // Re-queueing would strand it: a retired worker's run is never claimed again.
      if (await cancelStale(run, guard, now)) recovered += 1;
      continue;
    }
    if (run.attempt < run.maxAttempts) {
      const result = await db.run.updateMany({
        where: guard,
        data: { status: "QUEUED", attempt: run.attempt + 1, availableAt: now, lockedBy: null, lockedAt: null, heartbeatAt: null, error: STALE_RETRY_MESSAGE },
      });
      if (result.count === 0) continue;
      recovered += 1;
      log.warn(`recovered stale run ${run.id} → QUEUED (attempt ${run.attempt + 1}/${run.maxAttempts})`);
      continue;
    }

    const activeMs = parseCheckpoint(run.checkpoint)?.counters.activeMs ?? 0;
    const result = await db.run.updateMany({
      where: guard,
      data: { status: "FAILED", error: STALE_FINAL_MESSAGE, finishedAt: now, durationMs: Math.round(activeMs), lockedBy: null, lockedAt: null, heartbeatAt: null },
    });
    if (result.count === 0) continue;
    recovered += 1;
    // Same tidy-up as every other terminal transition: nothing may look in flight on a finished run.
    await closeOpenWork(db, run.id, now);
    log.warn(`stale run ${run.id} failed: attempts exhausted`);
    try {
      await refreshWorkerScore(run.workerId);
    } catch (e) {
      log.error(`could not refresh the score of worker ${run.workerId}`, e);
    }
    await recordActivity({
      organizationId: run.organizationId,
      type: "RUN_FAILED",
      title: `${run.worker.name} could not finish a run`,
      detail: STALE_FINAL_MESSAGE,
      workerId: run.workerId,
      jobId: run.jobId,
      runId: run.id,
      actorType: "SYSTEM",
    });
  }
  return recovered + (await sweepOrphanedRuns(opts));
}

type StaleRun = { id: string; organizationId: string; workerId: string; jobId: string; checkpoint: unknown; worker: { name: string } };

async function cancelStale(run: StaleRun, guard: { id: string; status: "RUNNING"; heartbeatAt: Date | null }, now: Date): Promise<boolean> {
  const activeMs = parseCheckpoint(run.checkpoint)?.counters.activeMs ?? 0;
  const result = await db.run.updateMany({
    where: guard,
    data: { status: "CANCELLED", error: WORKER_RETIRED_REASON, finishedAt: now, durationMs: Math.round(activeMs), lockedBy: null, lockedAt: null, heartbeatAt: null },
  });
  if (result.count === 0) return false;
  await closeOpenWork(db, run.id, now);
  log.warn(`stale run ${run.id} cancelled: its worker was retired`);
  await recordActivity({
    organizationId: run.organizationId,
    type: "RUN_CANCELLED",
    title: `${run.worker.name}’s run was cancelled`,
    detail: WORKER_RETIRED_REASON,
    workerId: run.workerId,
    jobId: run.jobId,
    runId: run.id,
    actorType: "SYSTEM",
  });
  return true;
}

/** A fresh Run (trigger RETRY) for a FAILED or CANCELLED one, carrying the original input. */
export async function retryRun(s: SessionContext, runId: string): Promise<{ runId: string }> {
  const run = await db.run.findFirst({
    where: { id: runId, organizationId: s.organizationId },
    select: { status: true, workerId: true, input: true },
  });
  if (!run) throw notFound("Run");
  if (run.status !== "FAILED" && run.status !== "CANCELLED") throw conflict("Only failed or cancelled runs can be retried");
  const input = RunInputSchema.safeParse(run.input);
  return enqueueRun({
    organizationId: s.organizationId,
    workerId: run.workerId,
    trigger: "RETRY",
    input: input.success ? input.data : undefined,
    requestedById: s.userId,
  });
}
