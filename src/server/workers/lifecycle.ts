import { recordActivity } from "@/server/activity";
import type { SessionContext } from "@/server/auth/types";
import { db } from "@/server/db";
import { CadenceSchema, cadenceToWorkerFields, computeNextRunAt, describeCadence, workerFieldsToCadence, type Cadence } from "@/server/domain";
import { conflict, invalid } from "@/server/errors";
import { cancelWorkerRuns, enqueueRun } from "@/server/runtime";
import { tools } from "@/server/tools";
import { loadWorker, lowerFirst, plural } from "./shared";

/**
 * Worker lifecycle — pause / resume / retire, schedule and permission changes, and the manual "Run now". Status
 * changes are guarded updates on the status the caller saw, so two clicks cannot both "pause" the same worker.
 */

const MAX_INSTRUCTIONS = 10;
const MAX_INSTRUCTION_CHARS = 2_000;

export async function pauseWorker(s: SessionContext, workerId: string): Promise<void> {
  const worker = await loadWorker(s.organizationId, workerId);
  if (worker.status === "RETIRED") throw conflict(`${worker.name} is retired and cannot be paused`);
  if (worker.status === "PAUSED") throw conflict(`${worker.name} is already paused`);

  const result = await db.worker.updateMany({
    where: { id: worker.id, organizationId: s.organizationId, status: "ACTIVE" },
    data: { status: "PAUSED", nextRunAt: null },
  });
  if (result.count === 0) throw conflict(`${worker.name}'s status changed just now; refresh and try again`);

  // Queued work is dropped; a run waiting on your approval keeps waiting — the decision is still yours.
  const cancelled = await cancelWorkerRuns(s.organizationId, worker.id, ["QUEUED"]);
  await recordActivity({
    organizationId: s.organizationId,
    type: "WORKER_PAUSED",
    title: `${s.name} paused ${worker.name}`,
    detail: cancelled > 0 ? `${plural(cancelled, "queued run")} cancelled` : undefined,
    workerId: worker.id,
    jobId: worker.jobId,
    actorType: "USER",
    actorName: s.name,
  });
}

export async function resumeWorker(s: SessionContext, workerId: string): Promise<void> {
  const worker = await loadWorker(s.organizationId, workerId);
  if (worker.status === "RETIRED") throw conflict(`${worker.name} is retired; hire a new worker for this job instead`);
  if (worker.status === "ACTIVE") throw conflict(`${worker.name} is already active`);

  const cadence = workerFieldsToCadence(worker);
  const nextRunAt = computeNextRunAt(cadence, new Date());
  const result = await db.worker.updateMany({
    where: { id: worker.id, organizationId: s.organizationId, status: "PAUSED" },
    data: { status: "ACTIVE", nextRunAt },
  });
  if (result.count === 0) throw conflict(`${worker.name}'s status changed just now; refresh and try again`);

  await recordActivity({
    organizationId: s.organizationId,
    type: "WORKER_RESUMED",
    title: `${s.name} resumed ${worker.name}`,
    detail: nextRunAt ? `${describeCadence(cadence)} · next run ${nextRunAt.toISOString()}` : describeCadence(cadence),
    workerId: worker.id,
    jobId: worker.jobId,
    actorType: "USER",
    actorName: s.name,
  });
}

export async function retireWorker(s: SessionContext, workerId: string): Promise<void> {
  const worker = await loadWorker(s.organizationId, workerId);
  if (worker.status === "RETIRED") throw conflict(`${worker.name} is already retired`);

  const now = new Date();
  const jobReopened = await db.$transaction(async (tx) => {
    const result = await tx.worker.updateMany({
      where: { id: worker.id, organizationId: s.organizationId, status: { not: "RETIRED" } },
      data: { status: "RETIRED", retiredAt: now, nextRunAt: null },
    });
    if (result.count === 0) throw conflict(`${worker.name} was retired by someone else just now`);
    // An open proposal for a retired worker can never be applied; close it so nothing looks undecided.
    await tx.workerVersion.updateMany({ where: { workerId: worker.id, status: "PROPOSED" }, data: { status: "REJECTED" } });

    const remaining = await tx.worker.count({ where: { jobId: worker.jobId, status: { not: "RETIRED" }, id: { not: worker.id } } });
    if (remaining > 0 || (worker.job.status !== "STAFFED" && worker.job.status !== "PAUSED")) return false;
    await tx.job.update({ where: { id: worker.jobId }, data: { status: "SPEC_APPROVED" } });
    return true;
  });

  const cancelled = await cancelWorkerRuns(s.organizationId, worker.id, ["QUEUED", "WAITING_FOR_APPROVAL"]);
  const detail = [
    cancelled > 0 ? `${plural(cancelled, "open run")} cancelled` : null,
    jobReopened ? `“${worker.job.title}” is open for a new hire` : null,
  ].filter((x): x is string => x !== null);
  await recordActivity({
    organizationId: s.organizationId,
    type: "WORKER_RETIRED",
    title: `${s.name} retired ${worker.name}`,
    detail: detail.length > 0 ? detail.join(" · ") : undefined,
    workerId: worker.id,
    jobId: worker.jobId,
    actorType: "USER",
    actorName: s.name,
  });
}

export async function updateSchedule(s: SessionContext, workerId: string, schedule: Cadence): Promise<void> {
  const parsed = CadenceSchema.safeParse(schedule);
  if (!parsed.success) throw invalid("That schedule is not valid", { issues: parsed.error.issues });
  const cadence = parsed.data;

  const worker = await loadWorker(s.organizationId, workerId);
  if (worker.status === "RETIRED") throw conflict(`${worker.name} is retired; their schedule can no longer change`);

  const nextRunAt = worker.status === "ACTIVE" ? computeNextRunAt(cadence, new Date()) : null;
  await db.worker.update({
    where: { id: worker.id },
    data: { ...cadenceToWorkerFields(cadence), nextRunAt },
  });
  await recordActivity({
    organizationId: s.organizationId,
    type: "NOTE",
    title: `${s.name} changed ${worker.name}’s schedule to ${lowerFirst(describeCadence(cadence))}`,
    detail: nextRunAt ? `Next run ${nextRunAt.toISOString()}` : worker.status === "PAUSED" ? "Takes effect when resumed" : undefined,
    workerId: worker.id,
    jobId: worker.jobId,
    actorType: "USER",
    actorName: s.name,
  });
}

export async function updateToolGrant(
  s: SessionContext,
  workerId: string,
  toolName: string,
  patch: { requiresApproval?: boolean; revoked?: boolean },
): Promise<void> {
  const definition = tools.get(toolName);
  if (!definition) throw invalid(`Unknown tool "${toolName}"`);
  const worker = await loadWorker(s.organizationId, workerId);

  // Permissions are at least as strict as the registry default: a tool that ships approval-gated stays gated.
  if (patch.requiresApproval === false && definition.defaultRequiresApproval) {
    throw invalid(`${definition.displayName} always requires your approval`);
  }

  const existing = await db.workerToolGrant.findUnique({ where: { workerId_toolName: { workerId: worker.id, toolName } } });
  const now = new Date();
  const requiresApproval = patch.requiresApproval ?? existing?.requiresApproval ?? definition.defaultRequiresApproval;
  const revoked = patch.revoked ?? (existing ? existing.revokedAt !== null : false);

  const changes: string[] = [];
  if (!existing || requiresApproval !== existing.requiresApproval) {
    changes.push(`${requiresApproval ? "Approval now required" : "Approval no longer required"} for ${toolName}`);
  }
  if (!existing || revoked !== (existing.revokedAt !== null)) {
    changes.push(revoked ? `Access to ${toolName} revoked` : existing ? `Access to ${toolName} restored` : `Access to ${toolName} granted`);
  }
  if (changes.length === 0) return;

  await db.workerToolGrant.upsert({
    where: { workerId_toolName: { workerId: worker.id, toolName } },
    create: { workerId: worker.id, toolName, requiresApproval, grantedById: s.userId, revokedAt: revoked ? now : null },
    update: { requiresApproval, revokedAt: revoked ? (existing?.revokedAt ?? now) : null },
  });
  await recordActivity({
    organizationId: s.organizationId,
    type: "PERMISSION_CHANGED",
    title: changes.join(" · "),
    detail: `${s.name} changed ${worker.name}’s permissions for ${definition.displayName}`,
    workerId: worker.id,
    jobId: worker.jobId,
    actorType: "USER",
    actorName: s.name,
    metadata: { toolName },
  });
}

function cleanInstructions(instructions: readonly string[] | undefined): string[] {
  const clean = (instructions ?? []).map((i) => i.replace(/\s+/g, " ").trim()).filter((i) => i.length > 0);
  if (clean.length > MAX_INSTRUCTIONS) throw invalid(`At most ${MAX_INSTRUCTIONS} instructions per run`);
  for (const i of clean) {
    if (i.length > MAX_INSTRUCTION_CHARS) throw invalid(`Each instruction is at most ${MAX_INSTRUCTION_CHARS.toLocaleString("en-US")} characters`);
  }
  return clean;
}

/** "Run now" — the runtime verifies the worker is active and org-scoped, locks the version and queues the run. */
export async function startRun(s: SessionContext, workerId: string, opts: { instructions?: string[] } = {}): Promise<{ runId: string }> {
  const instructions = cleanInstructions(opts.instructions);
  return enqueueRun({
    organizationId: s.organizationId,
    workerId,
    trigger: "MANUAL",
    input: instructions.length > 0 ? { instructions } : undefined,
    requestedById: s.userId,
  });
}
