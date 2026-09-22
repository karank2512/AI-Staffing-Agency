import type { VersionChangeReason } from "@prisma/client";
import { recordActivity } from "@/server/activity";
import type { SessionContext } from "@/server/auth/types";
import { db, toJson, type DbOrTx } from "@/server/db";
import type { ReplacementAnalysis, WorkerBlueprint } from "@/server/domain";
import { AppError, conflict, notFound } from "@/server/errors";
import { clip, loadVersion, loadWorker, validateBlueprint, versionLabel } from "./shared";

/**
 * Version lifecycle: proposing and declining. A worker has at most ONE open proposal; proposing again supersedes
 * it. Activation (the only mutation that swaps what actually runs) lives in ./activate.ts.
 */

export type ProposalChangeReason = Extract<VersionChangeReason, "REPLACEMENT" | "SPEC_CHANGE" | "MANUAL">;

export interface CreateProposedVersionArgs {
  organizationId: string;
  workerId: string;
  blueprint: WorkerBlueprint;
  changeReason: ProposalChangeReason;
  changeSummary: string;
  analysis?: ReplacementAnalysis;
  userId?: string;
}

const MAX_SUMMARY_CHARS = 2_000;

/** Rule 5: a version that has run (lockedAt) or has left PROPOSED never changes again. */
export async function assertVersionMutable(versionId: string): Promise<void> {
  const version = await db.workerVersion.findUnique({
    where: { id: versionId },
    select: { version: true, status: true, lockedAt: true },
  });
  if (!version) throw notFound("Worker version");
  if (version.lockedAt) {
    throw new AppError("IMMUTABLE_VERSION", `Version ${version.version} has already run and can no longer be changed`);
  }
  if (version.status !== "PROPOSED") {
    throw new AppError("IMMUTABLE_VERSION", `Version ${version.version} is ${versionLabel(version.status)} and can no longer be changed`);
  }
}

async function latestApprovedSpecId(tx: DbOrTx, jobId: string): Promise<string | null> {
  const spec = await tx.jobSpec.findFirst({ where: { jobId, status: "APPROVED" }, orderBy: { version: "desc" }, select: { id: true } });
  return spec?.id ?? null;
}

function proposedTitle(reason: ProposalChangeReason, workerName: string, version: number): string {
  switch (reason) {
    case "REPLACEMENT":
      return `A replacement for ${workerName} is ready to review (v${version})`;
    case "SPEC_CHANGE":
      return `A change to how ${workerName} works is ready to review (v${version})`;
    case "MANUAL":
      return `A new version of ${workerName} is ready to review (v${version})`;
  }
}

export async function createProposedVersion(args: CreateProposedVersionArgs): Promise<{ versionId: string; version: number }> {
  const blueprint = validateBlueprint(args.blueprint);
  const changeSummary = clip(args.changeSummary, MAX_SUMMARY_CHARS);

  const created = await db.$transaction(async (tx) => {
    // Serialize proposals per worker so two concurrent proposals cannot both claim the same version number.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Worker" WHERE "id" = ${args.workerId} AND "organizationId" = ${args.organizationId} FOR UPDATE`;
    if (locked.length === 0) throw notFound("Worker");
    const worker = await loadWorker(args.organizationId, args.workerId, tx);
    if (worker.status === "RETIRED") throw conflict(`${worker.name} is retired; hire a new worker for this job instead`);

    const jobSpecId = worker.currentVersion?.jobSpecId ?? (await latestApprovedSpecId(tx, worker.jobId));
    if (!jobSpecId) throw conflict(`${worker.name} has no approved job spec to design against`);

    const open = await tx.workerVersion.findMany({ where: { workerId: worker.id, status: "PROPOSED" }, select: { id: true, version: true } });
    if (open.length > 0) {
      await tx.workerVersion.updateMany({ where: { id: { in: open.map((v) => v.id) } }, data: { status: "REJECTED" } });
    }

    const max = await tx.workerVersion.aggregate({ where: { workerId: worker.id }, _max: { version: true } });
    const version = (max._max.version ?? 0) + 1;
    const row = await tx.workerVersion.create({
      data: {
        workerId: worker.id,
        jobSpecId,
        version,
        status: "PROPOSED",
        blueprint: toJson(blueprint),
        changeReason: args.changeReason,
        changeSummary: changeSummary || null,
        ...(args.analysis ? { analysis: toJson(args.analysis) } : {}),
        parentVersionId: worker.currentVersionId,
        createdById: args.userId ?? null,
      },
      select: { id: true },
    });
    return { versionId: row.id, version, worker, superseded: open.map((v) => v.version) };
  });

  const actor = args.userId
    ? await db.user.findFirst({ where: { id: args.userId, organizationId: args.organizationId }, select: { name: true } })
    : null;
  const detail = [changeSummary || null, created.superseded.length > 0 ? `Supersedes v${created.superseded.join(", v")}` : null]
    .filter((s): s is string => s !== null)
    .join(" · ");
  await recordActivity({
    organizationId: args.organizationId,
    type: "VERSION_PROPOSED",
    title: proposedTitle(args.changeReason, created.worker.name, created.version),
    detail: detail || undefined,
    workerId: created.worker.id,
    jobId: created.worker.jobId,
    actorType: actor ? "USER" : "SYSTEM",
    actorName: actor?.name,
    metadata: { versionId: created.versionId, version: created.version, changeReason: args.changeReason },
  });
  return { versionId: created.versionId, version: created.version };
}

export async function rejectProposedVersion(s: SessionContext, versionId: string): Promise<void> {
  const version = await loadVersion(s.organizationId, versionId);
  if (version.status !== "PROPOSED") {
    throw conflict(`Version ${version.version} is ${versionLabel(version.status)} and is not awaiting a decision`);
  }
  const result = await db.workerVersion.updateMany({ where: { id: version.id, status: "PROPOSED" }, data: { status: "REJECTED" } });
  if (result.count === 0) throw conflict(`Version ${version.version} was decided by someone else just now`);

  const what = version.changeReason === "REPLACEMENT" ? "the proposed replacement for" : "the proposed change to";
  await recordActivity({
    organizationId: s.organizationId,
    type: "VERSION_REJECTED",
    title: `${s.name} declined ${what} ${version.worker.name} (v${version.version})`,
    detail: version.changeSummary ? clip(version.changeSummary, 200) : undefined,
    workerId: version.workerId,
    jobId: version.worker.jobId,
    actorType: "USER",
    actorName: s.name,
    metadata: { versionId: version.id, version: version.version, changeReason: version.changeReason },
  });
}
