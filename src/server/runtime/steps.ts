import { Prisma, type RunStepKind, type RunStepStatus } from "@prisma/client";
import { db, toJson, type DbOrTx } from "@/server/db";
import { clipText, compact, oneLine } from "./compact";
import { LockLost } from "./failure";

/**
 * RunStep writer with a monotonic index. The index never rewinds across attempts: the slice seeds `nextIndex`
 * from max(checkpoint hint, DB max + 1), and the (runId, index) unique constraint turns a collision — which
 * can only mean a second slice is writing this run — into a LockLost signal. Finishing a step is fenced on the
 * run's lease too, so a slice that lost its run mid-call cannot overwrite what the new owner wrote.
 */

export interface StepHandle {
  id: string;
  index: number;
  startedAt: Date;
}

export interface BeginStepArgs {
  kind: RunStepKind;
  title: string;
  componentId?: string;
  input?: unknown;
  detail?: string;
  /** Default RUNNING. */
  status?: RunStepStatus;
}

export interface FinishStepArgs {
  status: RunStepStatus;
  output?: unknown;
  error?: string;
  detail?: string;
  title?: string;
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

export class StepWriter {
  constructor(
    readonly runId: string,
    readonly attempt: number,
    /** Index the next step will take; mirrored into checkpoint.nextStepIndex on every save. */
    public nextIndex: number,
    /** Executor holding the run; when set, `finish` only lands while the run is still RUNNING under it. */
    private readonly lockedBy?: string,
  ) {}

  async begin(args: BeginStepArgs, tx?: DbOrTx): Promise<StepHandle> {
    const index = this.nextIndex;
    this.nextIndex += 1;
    const startedAt = new Date();
    try {
      const row = await (tx ?? db).runStep.create({
        data: {
          runId: this.runId,
          index,
          attempt: this.attempt,
          componentId: args.componentId ?? null,
          kind: args.kind,
          status: args.status ?? "RUNNING",
          title: oneLine(args.title),
          detail: args.detail ?? null,
          input: args.input === undefined ? undefined : toJson(compact(args.input)),
          startedAt,
        },
        select: { id: true },
      });
      return { id: row.id, index, startedAt };
    } catch (e) {
      if (isUniqueViolation(e)) throw new LockLost(`RunStep index ${index} of run ${this.runId} was taken by another executor`);
      throw e;
    }
  }

  private finishData(step: StepHandle, args: FinishStepArgs) {
    const now = new Date();
    return {
      status: args.status,
      finishedAt: now,
      durationMs: Math.max(0, now.getTime() - step.startedAt.getTime()),
      ...(args.output === undefined ? {} : { output: toJson(compact(args.output)) }),
      ...(args.error === undefined ? {} : { error: clipText(args.error, 2_000) }),
      ...(args.detail === undefined ? {} : { detail: args.detail }),
      ...(args.title === undefined ? {} : { title: oneLine(args.title) }),
    };
  }

  async finish(step: StepHandle, args: FinishStepArgs, tx?: DbOrTx): Promise<void> {
    const client = tx ?? db;
    const data = this.finishData(step, args);
    if (!this.lockedBy) {
      await client.runStep.update({ where: { id: step.id }, data });
      return;
    }
    const result = await client.runStep.updateMany({ where: { id: step.id, run: { status: "RUNNING", lockedBy: this.lockedBy } }, data });
    if (result.count === 0) throw new LockLost(`Run ${this.runId} is no longer held by ${this.lockedBy} (step ${step.index})`);
  }

  /** For the one step written after the terminal transition (EVALUATION): the lease is gone by design. */
  async finishAfterRelease(step: StepHandle, args: FinishStepArgs): Promise<void> {
    await db.runStep.update({ where: { id: step.id }, data: this.finishData(step, args) });
  }

  /** A step that starts and ends in one write (ERROR, DELIVERABLE). */
  async record(args: BeginStepArgs & FinishStepArgs, tx?: DbOrTx): Promise<StepHandle> {
    const handle = await this.begin({ ...args, status: "RUNNING" }, tx);
    await this.finish(handle, args, tx);
    return handle;
  }
}

/** Highest RunStep.index already written for the run, or -1. */
export async function maxStepIndex(runId: string): Promise<number> {
  const row = await db.runStep.aggregate({ where: { runId }, _max: { index: true } });
  return row._max.index ?? -1;
}
