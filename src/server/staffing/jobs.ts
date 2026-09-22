import type { Job, JobSpec as JobSpecRow } from "@prisma/client";
import { db, type DbOrTx } from "@/server/db";
import { IntakeAnswersSchema, JobSpecSchema, WorkerProposalSchema, type IntakeAnswers, type JobSpec, type WorkerProposal } from "@/server/domain";
import { AppError, notFound } from "@/server/errors";

/** Org-scoped reads shared by the hire flow. Every id that came from a client goes through one of these. */

export async function getJob(organizationId: string, jobId: string, tx: DbOrTx = db): Promise<Job> {
  const job = await tx.job.findFirst({ where: { id: jobId, organizationId } });
  if (!job) throw notFound("Job");
  return job;
}

export async function getJobSpecRow(organizationId: string, jobSpecId: string, tx: DbOrTx = db): Promise<JobSpecRow & { job: Job }> {
  const row = await tx.jobSpec.findFirst({ where: { id: jobSpecId, job: { organizationId } }, include: { job: true } });
  if (!row) throw notFound("Job spec");
  return row;
}

/** The spec the hire flow is currently working from: the newest one that is still DRAFT or APPROVED. */
export async function latestOpenSpec(jobId: string, tx: DbOrTx = db): Promise<JobSpecRow | null> {
  return tx.jobSpec.findFirst({ where: { jobId, status: { in: ["DRAFT", "APPROVED"] } }, orderBy: { version: "desc" } });
}

export async function nextSpecVersion(jobId: string, tx: DbOrTx = db): Promise<number> {
  const max = await tx.jobSpec.aggregate({ where: { jobId }, _max: { version: true } });
  return (max._max.version ?? 0) + 1;
}

/** Stored specs were validated on write; a failure here means the schema moved underneath the data. */
export function parseStoredSpec(value: unknown): JobSpec {
  const parsed = JobSpecSchema.safeParse(value);
  if (!parsed.success) throw new AppError("INTERNAL", "Stored job spec no longer matches the current schema", { issues: parsed.error.issues });
  return parsed.data;
}

export function parseIntake(value: unknown): IntakeAnswers | null {
  const parsed = IntakeAnswersSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** A proposal is only meaningful for the spec it was designed from; anything else is stale. */
export function parseProposal(value: unknown, forJobSpecId?: string): WorkerProposal | null {
  const parsed = WorkerProposalSchema.safeParse(value);
  if (!parsed.success) return null;
  if (forJobSpecId && parsed.data.jobSpecId !== forJobSpecId) return null;
  return parsed.data;
}
