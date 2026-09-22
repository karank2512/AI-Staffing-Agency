import { Prisma } from "@prisma/client";
import { recordActivity } from "@/server/activity";
import { assertCan } from "@/server/auth/permissions";
import type { SessionContext } from "@/server/auth/types";
import { db, toJson } from "@/server/db";
import { JobSpecSchema, type JobSpec } from "@/server/domain";
import { AppError, conflict } from "@/server/errors";
import { getJob, getJobSpecRow, latestOpenSpec, nextSpecVersion, parseStoredSpec } from "./jobs";

/** JobSpec lifecycle: edit while DRAFT → approve → (revise into a new DRAFT) · discard an unstaffed job. */

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Nested objects (deliverable, approvalPolicy, budget) merge key by key; arrays and cadence are replaced whole. */
function mergeSpec(current: JobSpec, patch: Partial<JobSpec>): unknown {
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const existing = merged[key];
    merged[key] = key !== "cadence" && isPlainObject(existing) && isPlainObject(value) ? { ...existing, ...value } : value;
  }
  merged.schemaVersion = 1;
  return merged;
}

function validationError(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): AppError {
  const issues = error.issues.map((i) => `${i.path.map(String).join(".") || "spec"}: ${i.message}`);
  return new AppError("VALIDATION", `The spec has ${issues.length} problem${issues.length === 1 ? "" : "s"}: ${issues.slice(0, 4).join("; ")}`, { issues });
}

export async function updateJobSpec(s: SessionContext, jobSpecId: string, patch: Partial<JobSpec>): Promise<JobSpec> {
  assertCan(s, "jobs.manage");
  const row = await getJobSpecRow(s.organizationId, jobSpecId);
  if (row.status !== "DRAFT") throw conflict("Only a draft spec can be edited. Revise the job to create a new draft.");

  const parsed = JobSpecSchema.safeParse(mergeSpec(parseStoredSpec(row.spec), patch));
  if (!parsed.success) throw validationError(parsed.error);
  const spec = parsed.data;

  await db.$transaction([
    db.jobSpec.update({ where: { id: row.id }, data: { spec: toJson(spec) } }),
    db.job.update({ where: { id: row.jobId }, data: { title: spec.title, jobFamily: spec.jobFamily } }),
  ]);
  return spec;
}

export async function approveJobSpec(s: SessionContext, jobSpecId: string): Promise<void> {
  assertCan(s, "jobs.manage");
  const row = await getJobSpecRow(s.organizationId, jobSpecId);
  if (row.status === "APPROVED") return; // already done — approving twice is not an error
  if (row.status === "SUPERSEDED") throw conflict("This version of the spec has been superseded; approve the latest draft instead.");
  if (row.job.status !== "DRAFT" && row.job.status !== "SPEC_APPROVED") throw conflict("This job is already staffed; changes go through the worker's Replace flow.");

  const spec = parseStoredSpec(row.spec);
  await db.$transaction(async (tx) => {
    await tx.jobSpec.updateMany({ where: { jobId: row.jobId, status: "APPROVED", id: { not: row.id } }, data: { status: "SUPERSEDED" } });
    await tx.jobSpec.update({ where: { id: row.id }, data: { status: "APPROVED", approvedAt: new Date() } });
    // A job that already has an approved spec keeps its status; only the first approval moves it forward.
    await tx.job.updateMany({ where: { id: row.jobId, status: "DRAFT" }, data: { status: "SPEC_APPROVED" } });
  });

  await recordActivity({
    organizationId: s.organizationId,
    type: "JOB_SPEC_APPROVED",
    title: `${s.name} approved the spec for “${spec.title}”`,
    detail: `Version ${row.version} · ${spec.deliverable.title} (${spec.deliverable.format})`,
    jobId: row.jobId,
    actorType: "USER",
    actorName: s.name,
    metadata: { jobSpecId: row.id, version: row.version },
  });
}

export async function reviseJobSpec(s: SessionContext, jobId: string): Promise<{ jobSpecId: string; spec: JobSpec }> {
  assertCan(s, "jobs.manage");
  const job = await getJob(s.organizationId, jobId);
  if (job.status !== "DRAFT" && job.status !== "SPEC_APPROVED") throw conflict("This job is already staffed; changes go through the worker's Replace flow.");

  return db.$transaction(async (tx) => {
    const latest = await latestOpenSpec(job.id, tx);
    if (!latest) throw conflict("There is no spec to revise yet.");
    const spec = parseStoredSpec(latest.spec);
    // One open draft at a time: the copy becomes the draft, the original stays as history.
    await tx.jobSpec.updateMany({ where: { jobId: job.id, status: "DRAFT" }, data: { status: "SUPERSEDED" } });
    const created = await tx.jobSpec.create({
      data: { jobId: job.id, version: await nextSpecVersion(job.id, tx), status: "DRAFT", spec: toJson(spec) },
    });
    await tx.job.update({ where: { id: job.id }, data: { status: "DRAFT", pendingProposal: Prisma.DbNull } });
    return { jobSpecId: created.id, spec };
  });
}

export async function discardJob(s: SessionContext, jobId: string): Promise<void> {
  assertCan(s, "jobs.manage");
  const job = await getJob(s.organizationId, jobId);
  if (job.status !== "DRAFT" && job.status !== "SPEC_APPROVED") throw conflict("Only an unstaffed job can be discarded.");
  const workers = await db.worker.count({ where: { jobId: job.id } });
  if (workers > 0) throw conflict("This job has had a worker; retire the worker instead of discarding the job.");
  await db.job.deleteMany({ where: { id: job.id, organizationId: s.organizationId } });
}
