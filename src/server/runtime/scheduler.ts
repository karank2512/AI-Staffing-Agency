import { db } from "@/server/db";
import { computeNextRunAt, workerFieldsToCadence } from "@/server/domain";
import { log } from "./log";
import { enqueueRun } from "./queue";

/**
 * Cron for workers. A worker is due when ACTIVE, nextRunAt has passed and it has no run in flight (queued,
 * running or waiting) — a slow worker never gets a backlog. Advancing nextRunAt is guarded on the value we
 * read, so two ticks racing on the same worker enqueue exactly one run.
 */
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
  for (const worker of due) {
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
      // The slot is consumed either way; the next tick will try the following one.
      log.error(`could not enqueue the scheduled run for ${worker.name} (${worker.id})`, e);
    }
  }
  return enqueued;
}
