import { db, type DbOrTx } from "@/server/db";
import { AppError } from "@/server/errors";

/**
 * Headcount ceiling per workspace (audit F-004). Every worker on the roster can spend money on a schedule, so
 * the number of them an org may keep is capped by `Organization.maxActiveWorkers` (ACTIVE + PAUSED; retired
 * workers are history and never count).
 *
 * Checked when a NEW seat is filled (`staffing.hireWorker`) and when a replacement takes over an existing seat
 * (`workers.hireReplacement`) — the latter passes its own worker in `excludeWorkerId`, because swapping a
 * worker's version must stay possible for an org that is already exactly at its cap.
 */
export async function assertHeadcount(
  organizationId: string,
  opts: { excludeWorkerId?: string; tx?: DbOrTx } = {},
): Promise<void> {
  const client = opts.tx ?? db;
  const org = await client.organization.findUnique({ where: { id: organizationId }, select: { maxActiveWorkers: true } });
  const max = org?.maxActiveWorkers ?? 10;
  const active = await client.worker.count({
    where: {
      organizationId,
      status: { in: ["ACTIVE", "PAUSED"] },
      ...(opts.excludeWorkerId ? { id: { not: opts.excludeWorkerId } } : {}),
    },
  });
  if (active >= max) {
    throw new AppError(
      "LIMIT_EXCEEDED",
      `Your workspace already has ${active} worker${active === 1 ? "" : "s"} — the limit is ${max}. Retire one before hiring another.`,
    );
  }
}
