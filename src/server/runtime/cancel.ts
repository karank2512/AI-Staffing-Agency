import { recordActivity } from "@/server/activity";
import { assertCan } from "@/server/auth/permissions";
import type { SessionContext } from "@/server/auth/types";
import { db } from "@/server/db";
import { isAppError, notFound } from "@/server/errors";
import { parseCheckpoint } from "./checkpoint";
import { transitionRun } from "./transitions";

/**
 * Cancellation. The terminal transition itself expires approvals, denies their tool calls and skips open steps.
 * A run that never started hands its one-off instructions back, so the worker's promise ("I'll apply this on my
 * next run") still holds after a pause or a manual cancel of a queued run.
 */

interface CancelArgs {
  runId: string;
  organizationId: string;
  reason: string;
  actor: { type: "USER" | "SYSTEM"; name?: string };
}

async function cancel(args: CancelArgs): Promise<void> {
  const run = await db.run.findFirst({
    where: { id: args.runId, organizationId: args.organizationId },
    select: { id: true, workerId: true, jobId: true, checkpoint: true, worker: { select: { name: true } } },
  });
  if (!run) throw notFound("Run");
  const activeMs = parseCheckpoint(run.checkpoint)?.counters.activeMs ?? 0;

  await db.$transaction(async (tx) => {
    await transitionRun(run.id, "CANCELLED", { error: args.reason, finishedAt: new Date(), durationMs: Math.round(activeMs) }, { tx });
    // Read inside the tx, after the guarded transition: a claim that raced us would have made it fail.
    const started = await tx.run.findUnique({ where: { id: run.id }, select: { startedAt: true } });
    if (started && started.startedAt === null) {
      await tx.workerMessage.updateMany({
        where: { organizationId: args.organizationId, workerId: run.workerId, appliedToRunId: run.id, classification: "TEMPORARY_INSTRUCTION" },
        data: { instructionActive: true, appliedToRunId: null },
      });
    }
  });

  await recordActivity({
    organizationId: args.organizationId,
    type: "RUN_CANCELLED",
    title: `${run.worker.name}’s run was cancelled`,
    detail: args.reason,
    workerId: run.workerId,
    jobId: run.jobId,
    runId: run.id,
    actorType: args.actor.type,
    actorName: args.actor.name,
  });
}

export async function cancelRun(s: SessionContext, runId: string): Promise<void> {
  assertCan(s, "workers.run");
  await cancel({
    runId,
    organizationId: s.organizationId,
    reason: `Cancelled by ${s.name}`,
    actor: { type: "USER", name: s.name },
  });
}

/** Cancels every run of the worker in the given statuses (pause → QUEUED, retire → QUEUED + WAITING). */
export async function cancelWorkerRuns(
  organizationId: string,
  workerId: string,
  statuses: Array<"QUEUED" | "WAITING_FOR_APPROVAL">,
): Promise<number> {
  if (statuses.length === 0) return 0;
  const runs = await db.run.findMany({
    where: { organizationId, workerId, status: { in: statuses } },
    select: { id: true },
  });
  let cancelled = 0;
  for (const run of runs) {
    try {
      await cancel({ runId: run.id, organizationId, reason: "Cancelled because the worker was paused or retired", actor: { type: "SYSTEM" } });
      cancelled += 1;
    } catch (e) {
      // The run finished or was picked up between the listing and the guarded transition — nothing to cancel.
      if (isAppError(e) && e.code === "INVALID_TRANSITION") continue;
      throw e;
    }
  }
  return cancelled;
}
