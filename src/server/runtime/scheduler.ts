import { recordActivity } from "@/server/activity";
import { db } from "@/server/db";
import { computeNextRunAt, workerFieldsToCadence } from "@/server/domain";
import { isAppError } from "@/server/errors";
import { log } from "./log";
import { enqueueRun } from "./queue";

/**
 * Cron for workers. A worker is due when ACTIVE, nextRunAt has passed and it has no run in flight (queued,
 * running or waiting) — a slow worker never gets a backlog. Advancing nextRunAt is guarded on the value we
 * read, so two ticks racing on the same worker enqueue exactly one run.
 */

/** Suspended or over-budget: the tick tells the org once, in their own feed, instead of throwing. */
const SKIP_CODES = new Set(["LIMIT_EXCEEDED", "FORBIDDEN"]);

export async function tickScheduler(now: Date = new Date(), opts: { organizationId?: string } = {}): Promise<number> {
  const due = await db.worker.findMany({
    where: {
      status: "ACTIVE",
      nextRunAt: { lte: now },
      ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
      runs: { none: { status: { in: ["QUEUED", "RUNNING", "WAITING_FOR_APPROVAL"] } } },
    },
    select: { id: true, organizationId: true, name: true, nextRunAt: true, scheduleKind: true, scheduleHour: true, scheduleDow: true },
    orderBy: { nextRunAt: "asc" },
  });

  let enqueued = 0;
  /** Orgs already told this tick that their scheduled work is on hold — one NOTE, not one per worker. */
  const paused = new Set<string>();
  for (const worker of due) {
    if (paused.has(worker.organizationId)) continue;
    const next = computeNextRunAt(workerFieldsToCadence(worker), now);
    const advanced = await db.worker.updateMany({
      where: { id: worker.id, organizationId: worker.organizationId, status: "ACTIVE", nextRunAt: worker.nextRunAt },
      data: { nextRunAt: next },
    });
    if (advanced.count === 0) continue;
    try {
      await enqueueRun({ organizationId: worker.organizationId, workerId: worker.id, trigger: "SCHEDULED" });
      enqueued += 1;
    } catch (e) {
      if (isAppError(e) && SKIP_CODES.has(e.code)) {
        paused.add(worker.organizationId);
        await recordActivity({
          organizationId: worker.organizationId,
          type: "NOTE",
          title: "Scheduled work is on hold",
          detail: e.message,
          workerId: worker.id,
          actorType: "SYSTEM",
        });
        continue;
      }
      // The slot is consumed either way; the next tick will try the following one.
      log.error(`could not enqueue the scheduled run for ${worker.name} (${worker.id})`, e);
    }
  }
  return enqueued;
}
