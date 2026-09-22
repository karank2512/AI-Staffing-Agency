import type { RunStatus } from "@prisma/client";
import { db } from "@/server/db";
import { renderJobBrief, safeParseBlueprint, type JobSpec, type WorkerBlueprint } from "@/server/domain";
import { JobSpecSchema } from "@/server/domain/job-spec";
import { notFound } from "@/server/errors";
import { parseCheckpoint } from "./checkpoint";
import { RunFailure } from "./failure";
import { emptyCheckpoint, RunInputSchema, type RunCheckpoint, type RunInput } from "./types";

/** Everything a slice needs about its run, loaded once. */
export interface RunBundle {
  run: {
    id: string;
    organizationId: string;
    jobId: string;
    workerId: string;
    workerVersionId: string;
    status: RunStatus;
    attempt: number;
    maxAttempts: number;
    simulated: boolean;
    lockedBy: string | null;
    input: RunInput;
    checkpoint: RunCheckpoint;
  };
  worker: { name: string; title: string };
  blueprint: WorkerBlueprint;
  spec: JobSpec;
}

const EMPTY_INPUT: RunInput = { instructions: [], params: {} };

export async function loadRunBundle(runId: string): Promise<RunBundle> {
  const row = await db.run.findUnique({
    where: { id: runId },
    select: {
      id: true,
      organizationId: true,
      jobId: true,
      workerId: true,
      workerVersionId: true,
      status: true,
      attempt: true,
      maxAttempts: true,
      simulated: true,
      lockedBy: true,
      input: true,
      checkpoint: true,
      worker: { select: { name: true, title: true } },
      workerVersion: { select: { blueprint: true, jobSpec: { select: { spec: true } } } },
    },
  });
  if (!row) throw notFound("Run");

  // A blueprint or spec that no longer parses cannot be executed, and never will on retry.
  const blueprint = safeParseBlueprint(row.workerVersion.blueprint);
  if (!blueprint.success) {
    throw new RunFailure("VALIDATION", `The worker’s blueprint is invalid: ${blueprint.error.issues.map((i) => i.message).join("; ")}`, false);
  }
  const spec = JobSpecSchema.safeParse(row.workerVersion.jobSpec.spec);
  if (!spec.success) {
    throw new RunFailure("VALIDATION", `The job spec is invalid: ${spec.error.issues.map((i) => i.message).join("; ")}`, false);
  }

  const parsedInput = RunInputSchema.safeParse(row.input ?? {});
  const input = parsedInput.success ? parsedInput.data : EMPTY_INPUT;
  const checkpoint = parseCheckpoint(row.checkpoint) ?? emptyCheckpoint();
  seedContext(checkpoint, spec.data, input);

  return {
    run: {
      id: row.id,
      organizationId: row.organizationId,
      jobId: row.jobId,
      workerId: row.workerId,
      workerVersionId: row.workerVersionId,
      status: row.status,
      attempt: row.attempt,
      maxAttempts: row.maxAttempts,
      simulated: row.simulated,
      lockedBy: row.lockedBy,
      input,
      checkpoint,
    },
    worker: row.worker,
    blueprint: blueprint.data,
    spec: spec.data,
  };
}

/** The two keys every blueprint may read before any component ran. Existing values are never overwritten. */
export function seedContext(checkpoint: RunCheckpoint, spec: JobSpec, input: RunInput): void {
  checkpoint.context.job_brief ??= renderJobBrief(spec);
  checkpoint.context.instructions ??= input.instructions;
}
