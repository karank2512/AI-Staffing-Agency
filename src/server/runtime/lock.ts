import type { Prisma, RunStatus } from "@prisma/client";
import { config } from "@/server/config";
import { db, type DbOrTx } from "@/server/db";
import { isAppError } from "@/server/errors";
import { LockLost } from "./failure";
import { log } from "./log";
import { transitionRun } from "./transitions";

/**
 * The executor's lease on one RUNNING run. Every write to the Run row goes through here and is fenced by
 * `{ id, status: RUNNING, lockedBy: executorId }`; a guard that matches nothing means another party owns the run
 * now (cancel, stale recovery, a second executor) and the slice must stop without writing anything else.
 */
export class RunLock {
  lost = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    readonly runId: string,
    readonly executorId: string,
  ) {}

  private fence() {
    return { id: this.runId, status: "RUNNING" as const, lockedBy: this.executorId };
  }

  /** Heartbeat every staleLockMs / 4 so recovery only ever fires for a genuinely dead executor. */
  start(): void {
    const every = Math.max(250, Math.floor(config.executor.staleLockMs / 4));
    this.timer = setInterval(() => void this.heartbeat(), every);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * Runs on a timer, so it must never throw: a lost lease is only NOTED here and surfaces as LockLost on the
   * slice's next fenced write (which is the first moment it could write anything wrong anyway).
   */
  private async heartbeat(): Promise<void> {
    if (this.lost) return;
    try {
      const result = await db.run.updateMany({ where: this.fence(), data: { heartbeatAt: new Date() } });
      if (result.count === 0) this.noteLost("heartbeat");
    } catch (e) {
      log.error(`heartbeat failed for run ${this.runId}`, e);
    }
  }

  private noteLost(where: string): void {
    if (!this.lost) log.warn(`lock on run ${this.runId} lost (${where}); stopping`);
    this.lost = true;
    this.stop();
  }

  private markLost(where: string): never {
    this.noteLost(where);
    throw new LockLost(`Run ${this.runId} is no longer held by ${this.executorId} (${where})`);
  }

  /** Fenced patch of the Run row (checkpoint saves). */
  async write(data: Prisma.RunUpdateManyMutationInput, tx?: DbOrTx): Promise<void> {
    if (this.lost) this.markLost("write");
    const result = await (tx ?? db).run.updateMany({ where: this.fence(), data });
    if (result.count === 0) this.markLost("write");
  }

  /** Fenced status change out of RUNNING (pause, retry, success, failure). */
  async transition(to: RunStatus, patch: Prisma.RunUpdateManyMutationInput, tx?: DbOrTx): Promise<void> {
    if (this.lost) this.markLost("transition");
    try {
      await transitionRun(this.runId, to, patch, { expectLockedBy: this.executorId, tx });
    } catch (e) {
      if (isAppError(e) && e.code === "INVALID_TRANSITION") this.markLost(`transition to ${to}`);
      throw e;
    }
    // The lease is released by the transition itself; heartbeats would only fail from here on.
    this.stop();
  }

  /** Component-boundary check: re-read the row so a cancel is noticed before the next expensive step. */
  async assertHeld(): Promise<void> {
    if (this.lost) this.markLost("check");
    const run = await db.run.findUnique({ where: { id: this.runId }, select: { status: true, lockedBy: true } });
    if (!run || run.status !== "RUNNING" || run.lockedBy !== this.executorId) this.markLost("check");
  }
}
