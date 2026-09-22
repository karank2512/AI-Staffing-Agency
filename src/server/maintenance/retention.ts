import { Prisma } from "@prisma/client";
import { config } from "@/server/config";
import { db } from "@/server/db";

/**
 * Data retention (audit OPS-12 / INF-20). Debug traces — model prompts/responses and step inputs/outputs — can
 * contain whatever a customer asked a worker to read, so they are cleared on a schedule while the *metrics* on the
 * same rows (tokens, cost, latency, durations, titles) are kept forever: the timeline and the usage pages keep
 * working, the payloads simply stop being readable.
 *
 * Every pass is batched. A single `UPDATE … WHERE id IN (…1000 ids)` finishes in milliseconds, so a sweep on a
 * large table never holds locks long enough to block a run, and a slow pass just picks up where it left off on the
 * next tick.
 */

/** Runs whose payloads are safe to clear — a live run still reads its own steps. */
const TERMINAL_RUN_STATUSES = ["SUCCEEDED", "FAILED", "CANCELLED"] as const;

export interface RetentionOptions {
  now?: Date;
  /** Rows touched per statement. */
  batchSize?: number;
  /** Safety valve so one tick cannot run for an unbounded time on a huge backlog. */
  maxBatches?: number;
  /** Restrict the sweep to one tenant (used by tests and by a future per-org purge). */
  organizationId?: string;
}

export interface RetentionResult {
  /** ModelCall rows whose request/response payloads were cleared. */
  modelCallsCleared: number;
  /** RunStep rows whose input/output payloads were cleared. */
  runStepsCleared: number;
  activityEventsDeleted: number;
  securityEventsDeleted: number;
  /** True when a limit stopped the sweep early; the next tick continues. */
  truncated: boolean;
}

const DAY_MS = 86_400_000;

interface BatchOutcome {
  count: number;
  truncated: boolean;
}

/**
 * Drives one table: read a page of ids, act on exactly those ids, repeat. Reading ids first keeps the mutating
 * statement bounded and makes the pass restartable — Prisma has no `UPDATE … LIMIT`.
 */
async function batched(
  batchSize: number,
  maxBatches: number,
  selectIds: (take: number) => Promise<string[]>,
  apply: (ids: string[]) => Promise<number>,
): Promise<BatchOutcome> {
  let count = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const ids = await selectIds(batchSize);
    if (ids.length === 0) return { count, truncated: false };
    count += await apply(ids);
    if (ids.length < batchSize) return { count, truncated: false };
  }
  return { count, truncated: true };
}

function orgFilter(organizationId?: string) {
  return organizationId ? { organizationId } : {};
}

async function clearModelCallPayloads(before: Date, batchSize: number, maxBatches: number, organizationId?: string) {
  const where: Prisma.ModelCallWhereInput = {
    createdAt: { lt: before },
    ...orgFilter(organizationId),
    OR: [{ request: { not: Prisma.DbNull } }, { response: { not: Prisma.DbNull } }],
  };
  return batched(
    batchSize,
    maxBatches,
    async (take) => (await db.modelCall.findMany({ where, select: { id: true }, take })).map((r) => r.id),
    async (ids) =>
      (await db.modelCall.updateMany({ where: { id: { in: ids } }, data: { request: Prisma.DbNull, response: Prisma.DbNull } })).count,
  );
}

async function clearRunStepPayloads(before: Date, batchSize: number, maxBatches: number, organizationId?: string) {
  const where: Prisma.RunStepWhereInput = {
    startedAt: { lt: before },
    run: { status: { in: [...TERMINAL_RUN_STATUSES] }, ...orgFilter(organizationId) },
    OR: [{ input: { not: Prisma.DbNull } }, { output: { not: Prisma.DbNull } }],
  };
  return batched(
    batchSize,
    maxBatches,
    async (take) => (await db.runStep.findMany({ where, select: { id: true }, take })).map((r) => r.id),
    async (ids) => (await db.runStep.updateMany({ where: { id: { in: ids } }, data: { input: Prisma.DbNull, output: Prisma.DbNull } })).count,
  );
}

async function deleteActivityEvents(before: Date, batchSize: number, maxBatches: number, organizationId?: string) {
  const where: Prisma.ActivityEventWhereInput = { createdAt: { lt: before }, ...orgFilter(organizationId) };
  return batched(
    batchSize,
    maxBatches,
    async (take) => (await db.activityEvent.findMany({ where, select: { id: true }, take })).map((r) => r.id),
    async (ids) => (await db.activityEvent.deleteMany({ where: { id: { in: ids } } })).count,
  );
}

async function deleteSecurityEvents(before: Date, batchSize: number, maxBatches: number, organizationId?: string) {
  const where: Prisma.SecurityEventWhereInput = { createdAt: { lt: before }, ...orgFilter(organizationId) };
  return batched(
    batchSize,
    maxBatches,
    async (take) => (await db.securityEvent.findMany({ where, select: { id: true }, take })).map((r) => r.id),
    async (ids) => (await db.securityEvent.deleteMany({ where: { id: { in: ids } } })).count,
  );
}

/**
 * One retention pass. Idempotent and safe to run from several workers at once: each statement is guarded by the
 * ids it just read, so a concurrent sweep simply finds nothing left to do.
 */
export async function runRetention(opts: RetentionOptions = {}): Promise<RetentionResult> {
  const now = opts.now ?? new Date();
  const batchSize = Math.max(1, opts.batchSize ?? 1_000);
  const maxBatches = Math.max(1, opts.maxBatches ?? 50);
  const { organizationId } = opts;

  const traceBefore = new Date(now.getTime() - config.retention.traceDays * DAY_MS);
  const eventsBefore = new Date(now.getTime() - config.retention.eventsDays * DAY_MS);

  const modelCalls = await clearModelCallPayloads(traceBefore, batchSize, maxBatches, organizationId);
  const runSteps = await clearRunStepPayloads(traceBefore, batchSize, maxBatches, organizationId);
  const activity = await deleteActivityEvents(eventsBefore, batchSize, maxBatches, organizationId);
  const security = await deleteSecurityEvents(eventsBefore, batchSize, maxBatches, organizationId);

  return {
    modelCallsCleared: modelCalls.count,
    runStepsCleared: runSteps.count,
    activityEventsDeleted: activity.count,
    securityEventsDeleted: security.count,
    truncated: modelCalls.truncated || runSteps.truncated || activity.truncated || security.truncated,
  };
}
