import type { RunStepKind } from "@prisma/client";
import { db, toJson } from "@/server/db";
import { enqueueRun } from "@/server/runtime";
import type { RunCheckpoint } from "@/server/runtime/types";
import type { createTestOrg } from "../helpers/factory";
import type { createHiredWorker } from "../helpers/fixtures";

export type TestOrg = Awaited<ReturnType<typeof createTestOrg>>;
export type Hired = Awaited<ReturnType<typeof createHiredWorker>>;

/** Run.checkpoint parsed loosely for assertions (the runtime's own parser is not part of the public surface). */
export function checkpointOf(run: { checkpoint: unknown }): RunCheckpoint {
  return run.checkpoint as RunCheckpoint;
}

export async function loadRun(runId: string) {
  return db.run.findUniqueOrThrow({ where: { id: runId } });
}

export async function stepsOf(runId: string) {
  return db.runStep.findMany({ where: { runId }, orderBy: { index: "asc" } });
}

export function kindsOf(steps: Array<{ kind: RunStepKind }>): Set<RunStepKind> {
  return new Set(steps.map((s) => s.kind));
}

export async function activityTypes(organizationId: string, runId: string): Promise<string[]> {
  const rows = await db.activityEvent.findMany({ where: { organizationId, runId }, orderBy: { createdAt: "asc" }, select: { type: true } });
  return rows.map((r) => r.type);
}

/** Enqueue a manual run for the hired worker and return its id. */
export async function enqueue(t: TestOrg, hired: Hired, input?: { instructions?: string[] }): Promise<string> {
  const { runId } = await enqueueRun({ organizationId: t.organization.id, workerId: hired.worker.id, trigger: "MANUAL", input, requestedById: t.user.id });
  return runId;
}

/** A hand-written RUNNING run held by a (dead) executor, used for stale-recovery and fencing tests. */
export async function createRunningRun(t: TestOrg, hired: Hired, opts: { lockedBy: string; heartbeatAt: Date; attempt?: number; maxAttempts?: number; checkpoint?: Partial<RunCheckpoint> }) {
  return db.run.create({
    data: {
      organizationId: t.organization.id,
      jobId: hired.job.id,
      workerId: hired.worker.id,
      workerVersionId: hired.version.id,
      status: "RUNNING",
      trigger: "MANUAL",
      simulated: true,
      attempt: opts.attempt ?? 1,
      maxAttempts: opts.maxAttempts ?? 2,
      lockedBy: opts.lockedBy,
      lockedAt: opts.heartbeatAt,
      heartbeatAt: opts.heartbeatAt,
      startedAt: opts.heartbeatAt,
      input: toJson({ instructions: [], params: {} }),
      ...(opts.checkpoint ? { checkpoint: toJson(opts.checkpoint) } : {}),
    },
  });
}

export const MINUTES = 60_000;
