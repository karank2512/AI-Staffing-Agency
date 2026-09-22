import { db } from "@/server/db";

/**
 * Executor liveness. Each running executor keeps one `ExecutorHeartbeat` row fresh so an operator (and
 * `/api/ready`) can tell whether any worker process is alive and how much it is carrying, without inspecting
 * container internals. The row is deleted on a clean shutdown; a crashed executor's row is swept by age.
 */

/** A heartbeat older than this belongs to a process that is gone. */
export const HEARTBEAT_STALE_MS = 5 * 60_000;

export interface ExecutorHeartbeatView {
  executorId: string;
  hostname: string;
  inFlight: number;
  startedAt: string;
  seenAt: string;
}

export async function recordHeartbeat(executorId: string, hostname: string, inFlight: number): Promise<void> {
  await db.executorHeartbeat.upsert({
    where: { executorId },
    create: { executorId, hostname, inFlight },
    update: { hostname, inFlight },
  });
}

/** Best-effort removal of this process's own row on shutdown. */
export async function clearHeartbeat(executorId: string): Promise<void> {
  await db.executorHeartbeat.deleteMany({ where: { executorId } });
}

export async function sweepStaleHeartbeats(opts: { now?: Date; maxAgeMs?: number } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - (opts.maxAgeMs ?? HEARTBEAT_STALE_MS));
  const { count } = await db.executorHeartbeat.deleteMany({ where: { seenAt: { lt: cutoff } } });
  return count;
}

/** Live executors, newest heartbeat first. Informational only — readiness never fails on it. */
export async function listLiveExecutors(opts: { now?: Date; maxAgeMs?: number } = {}): Promise<ExecutorHeartbeatView[]> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.maxAgeMs ?? HEARTBEAT_STALE_MS));
  const rows = await db.executorHeartbeat.findMany({ where: { seenAt: { gte: since } }, orderBy: { seenAt: "desc" }, take: 25 });
  return rows.map((r) => ({
    executorId: r.executorId,
    hostname: r.hostname,
    inFlight: r.inFlight,
    startedAt: r.startedAt.toISOString(),
    seenAt: r.seenAt.toISOString(),
  }));
}
