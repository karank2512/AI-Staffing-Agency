import type { PrismaClient } from "@prisma/client";

/**
 * "Happened at" for real server calls. The seed drives the actual evaluation, feedback, chat, review and scoping
 * code (so scores, verdicts and replies are exactly what the product would compute) and then moves every row that
 * call stamped with the real clock back onto the demo timeline. History is always in the past, so anything in
 * the org stamped at or after the moment the call started was written by that call.
 */

/** Postgres timestamp(3) rounds sub-millisecond values; a small margin keeps a row stamped "now" inside the window. */
const CLOCK_MARGIN_MS = 5;

const shifted = (value: Date, delta: number) => new Date(value.getTime() + delta);

export async function backdate<T>(db: PrismaClient, organizationId: string, at: Date, fn: () => Promise<T>): Promise<T> {
  const since = new Date(Date.now() - CLOCK_MARGIN_MS);
  const result = await fn();
  await shiftRowsSince(db, organizationId, since, at.getTime() - since.getTime());
  return result;
}

async function shiftRowsSince(db: PrismaClient, organizationId: string, since: Date, delta: number): Promise<void> {
  const org = { organizationId };

  for (const row of await db.modelCall.findMany({ where: { ...org, createdAt: { gte: since } }, select: { id: true, createdAt: true } })) {
    await db.modelCall.update({ where: { id: row.id }, data: { createdAt: shifted(row.createdAt, delta) } });
  }
  for (const row of await db.usageRecord.findMany({ where: { ...org, occurredAt: { gte: since } }, select: { id: true, occurredAt: true } })) {
    await db.usageRecord.update({ where: { id: row.id }, data: { occurredAt: shifted(row.occurredAt, delta) } });
  }
  for (const row of await db.activityEvent.findMany({ where: { ...org, createdAt: { gte: since } }, select: { id: true, createdAt: true } })) {
    await db.activityEvent.update({ where: { id: row.id }, data: { createdAt: shifted(row.createdAt, delta) } });
  }
  for (const row of await db.evaluation.findMany({ where: { ...org, createdAt: { gte: since } }, select: { id: true, createdAt: true } })) {
    await db.evaluation.update({ where: { id: row.id }, data: { createdAt: shifted(row.createdAt, delta) } });
  }
  for (const row of await db.workerMessage.findMany({ where: { ...org, createdAt: { gte: since } }, select: { id: true, createdAt: true } })) {
    await db.workerMessage.update({ where: { id: row.id }, data: { createdAt: shifted(row.createdAt, delta) } });
  }
  for (const row of await db.workerReview.findMany({ where: { ...org, createdAt: { gte: since } }, select: { id: true, createdAt: true, periodStart: true, periodEnd: true } })) {
    await db.workerReview.update({
      where: { id: row.id },
      data: { createdAt: shifted(row.createdAt, delta), periodStart: shifted(row.periodStart, delta), periodEnd: shifted(row.periodEnd, delta) },
    });
  }
  for (const row of await db.deliverable.findMany({ where: { ...org, reviewedAt: { gte: since } }, select: { id: true, reviewedAt: true } })) {
    if (row.reviewedAt) await db.deliverable.update({ where: { id: row.id }, data: { reviewedAt: shifted(row.reviewedAt, delta) } });
  }
  for (const row of await db.job.findMany({ where: { ...org, updatedAt: { gte: since } }, select: { id: true, createdAt: true, updatedAt: true } })) {
    // updatedAt is @updatedAt: set it explicitly or Prisma stamps the real clock again.
    await db.job.update({
      where: { id: row.id },
      data: { ...(row.createdAt >= since ? { createdAt: shifted(row.createdAt, delta) } : {}), updatedAt: shifted(row.updatedAt, delta) },
    });
  }
  for (const row of await db.jobSpec.findMany({
    where: { job: org, OR: [{ createdAt: { gte: since } }, { approvedAt: { gte: since } }] },
    select: { id: true, createdAt: true, approvedAt: true },
  })) {
    await db.jobSpec.update({
      where: { id: row.id },
      data: {
        ...(row.createdAt >= since ? { createdAt: shifted(row.createdAt, delta) } : {}),
        ...(row.approvedAt && row.approvedAt >= since ? { approvedAt: shifted(row.approvedAt, delta) } : {}),
      },
    });
  }
}
