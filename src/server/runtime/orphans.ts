import { db } from "@/server/db";
import { cancelWorkerRuns } from "./cancel";
import { log } from "./log";
import { transitionRun } from "./transitions";

/**
 * Backstop for runs that can never move again on their own. The runtime avoids creating them (retired-worker
 * checks at every boundary, row-locked approval decisions), but a run parked before those checks existed — or by
 * a race nobody foresaw — would otherwise sit "in flight" forever and keep every live view polling:
 *
 *   - QUEUED / WAITING_FOR_APPROVAL runs of a RETIRED worker (claimNextRun only serves ACTIVE workers) → cancelled
 *   - WAITING_FOR_APPROVAL runs with no PENDING approval left (nothing will ever re-queue them) → re-queued
 *
 * Runs from the stale-recovery pass (recoverStaleRuns), with the same optional organization scope.
 */
export async function sweepOrphanedRuns(opts: { organizationId?: string } = {}): Promise<number> {
  const scope = opts.organizationId ? { organizationId: opts.organizationId } : {};
  let swept = 0;

  const retired = await db.run.findMany({
    where: { ...scope, status: { in: ["QUEUED", "WAITING_FOR_APPROVAL"] }, worker: { status: "RETIRED" } },
    select: { organizationId: true, workerId: true },
    distinct: ["workerId"],
  });
  for (const { organizationId, workerId } of retired) {
    swept += await cancelWorkerRuns(organizationId, workerId, ["QUEUED", "WAITING_FOR_APPROVAL"]);
  }

  const stuck = await db.run.findMany({
    where: { ...scope, status: "WAITING_FOR_APPROVAL", approvals: { none: { status: "PENDING" } }, worker: { status: { not: "RETIRED" } } },
    select: { id: true },
  });
  for (const { id } of stuck) {
    const requeued = await db.$transaction(async (tx) => {
      // Same lock decideApproval takes, so a decision landing right now is either fully before or after us.
      await tx.$queryRaw`SELECT "id" FROM "Run" WHERE "id" = ${id} FOR UPDATE`;
      const run = await tx.run.findUnique({ where: { id }, select: { status: true } });
      if (run?.status !== "WAITING_FOR_APPROVAL") return false;
      if ((await tx.approval.count({ where: { runId: id, status: "PENDING" } })) > 0) return false;
      await transitionRun(id, "QUEUED", { availableAt: new Date() }, { tx });
      return true;
    });
    if (requeued) {
      swept += 1;
      log.warn(`run ${id} was waiting with no pending approval; re-queued`);
    }
  }
  return swept;
}
