import { recordActivity } from "@/server/activity";
import type { SessionContext } from "@/server/auth/types";
import { db, toJson, type DbTx } from "@/server/db";
import { cadenceToWorkerFields, computeNextRunAt, safeParseBlueprint, type ToolRequirement, type WorkerBlueprint } from "@/server/domain";
import { AppError, conflict, invalid, isAppError } from "@/server/errors";
import { cancelRun } from "@/server/runtime";
import { tools } from "@/server/tools";
import { clip, loadVersion, parseStoredBlueprint, plural, versionLabel } from "./shared";

/**
 * activateVersion — the moment a proposal becomes the worker. One transaction swaps the current version, syncs the
 * permission grants to the new blueprint, resets the worker's track record (a new version starts clean) and
 * re-derives the schedule. It refuses while a run is in flight so no run ever straddles two versions, and cancels
 * runs still queued on the outgoing version so none of them executes on the replaced design.
 */

const MAX_NAME_CHARS = 40;

function cleanName(requested: string): string {
  const clean = requested.replace(/\s+/g, " ").trim();
  if (clean.length === 0) throw invalid("Worker names cannot be empty.");
  if (clean.length > MAX_NAME_CHARS) throw invalid(`Worker names are at most ${MAX_NAME_CHARS} characters.`);
  return clean;
}

interface GrantSyncResult {
  granted: string[];
  restored: string[];
  revoked: string[];
}

/**
 * Grants follow the blueprint, never the other way round:
 * - tools new to the blueprint get a grant (at least as strict as the registry default);
 * - existing grants keep user-tightened settings (an approval the user added stays; a grant the user revoked on a
 *   tool that is still in the blueprint stays revoked);
 * - a grant revoked only because an earlier version dropped the tool is restored when the tool comes back;
 * - tools no longer in the blueprint are revoked.
 */
async function syncGrants(
  tx: DbTx,
  args: { workerId: string; previousTools: ReadonlySet<string>; requirements: ToolRequirement[]; grantedById: string; now: Date },
): Promise<GrantSyncResult> {
  const grants = await tx.workerToolGrant.findMany({ where: { workerId: args.workerId } });
  const byName = new Map(grants.map((g) => [g.toolName, g] as const));
  const wanted = new Set(args.requirements.map((r) => r.toolName));
  const result: GrantSyncResult = { granted: [], restored: [], revoked: [] };

  for (const requirement of args.requirements) {
    const strict = requirement.requiresApproval || (tools.get(requirement.toolName)?.defaultRequiresApproval ?? false);
    const existing = byName.get(requirement.toolName);
    if (!existing) {
      await tx.workerToolGrant.create({
        data: { workerId: args.workerId, toolName: requirement.toolName, requiresApproval: strict, grantedById: args.grantedById },
      });
      result.granted.push(requirement.toolName);
      continue;
    }
    const requiresApproval = existing.requiresApproval || strict;
    const restore = existing.revokedAt !== null && !args.previousTools.has(requirement.toolName);
    if (requiresApproval !== existing.requiresApproval || restore) {
      await tx.workerToolGrant.update({
        where: { id: existing.id },
        data: { requiresApproval, ...(restore ? { revokedAt: null, grantedById: args.grantedById } : {}) },
      });
      if (restore) result.restored.push(requirement.toolName);
    }
  }

  for (const grant of grants) {
    if (wanted.has(grant.toolName) || grant.revokedAt !== null) continue;
    await tx.workerToolGrant.update({ where: { id: grant.id }, data: { revokedAt: args.now } });
    result.revoked.push(grant.toolName);
  }
  return result;
}

function previousToolNames(blueprint: unknown): Set<string> {
  const parsed = safeParseBlueprint(blueprint);
  return new Set(parsed.success ? parsed.data.tools.map((t) => t.toolName) : []);
}

function grantDetail(sync: GrantSyncResult): string[] {
  const lines: string[] = [];
  if (sync.granted.length > 0) lines.push(`granted ${sync.granted.join(", ")}`);
  if (sync.restored.length > 0) lines.push(`restored ${sync.restored.join(", ")}`);
  if (sync.revoked.length > 0) lines.push(`revoked ${sync.revoked.join(", ")}`);
  return lines;
}

/**
 * Runs still QUEUED on an outgoing version — a retry waiting out its backoff, a run released by an approval, one
 * waiting for an executor slot — would otherwise execute on the replaced design after the swap (with grants
 * already synced to the new one). They are cancelled before the swap; the swap itself refuses if one slips in.
 * Nothing is cancelled when the activation is going to be refused anyway.
 */
async function cancelOutgoingQueuedRuns(s: SessionContext, versionId: string): Promise<number> {
  const version = await loadVersion(s.organizationId, versionId);
  if (version.status !== "PROPOSED" || version.worker.status === "RETIRED") return 0;
  const workerId = version.worker.id;
  const inFlight = await db.run.count({ where: { organizationId: s.organizationId, workerId, status: { in: ["RUNNING", "WAITING_FOR_APPROVAL"] } } });
  if (inFlight > 0) return 0;
  const queued = await db.run.findMany({
    where: { organizationId: s.organizationId, workerId, status: "QUEUED", workerVersionId: { not: version.id } },
    select: { id: true },
  });
  let cancelled = 0;
  for (const run of queued) {
    try {
      await cancelRun(s, run.id);
      cancelled += 1;
    } catch (e) {
      // Claimed (or finished) between the listing and the guarded transition: the swap below will refuse.
      if (!isAppError(e) || e.code !== "INVALID_TRANSITION") throw e;
    }
  }
  return cancelled;
}

export async function activateVersion(s: SessionContext, versionId: string, opts: { newName?: string } = {}): Promise<void> {
  const newName = opts.newName === undefined ? undefined : cleanName(opts.newName);
  const cancelledQueued = await cancelOutgoingQueuedRuns(s, versionId);

  const activated = await db.$transaction(async (tx) => {
    const version = await loadVersion(s.organizationId, versionId, tx);
    if (version.status !== "PROPOSED") {
      throw conflict(`Version ${version.version} is ${versionLabel(version.status)} and cannot be activated`);
    }
    const worker = version.worker;
    if (worker.status === "RETIRED") throw conflict(`${worker.name} is retired; hire a new worker for this job instead`);

    const inFlight = await tx.run.count({ where: { workerId: worker.id, status: { in: ["RUNNING", "WAITING_FOR_APPROVAL"] } } });
    if (inFlight > 0) {
      throw conflict(`${worker.name} is in the middle of a run. Wait for it to finish, or cancel it, before switching versions.`);
    }
    const queuedOnOld = await tx.run.count({ where: { workerId: worker.id, status: "QUEUED", workerVersionId: { not: version.id } } });
    if (queuedOnOld > 0) {
      throw conflict(`${worker.name} just queued a run on the current version. Try again in a moment, or cancel that run first.`);
    }

    let blueprint: WorkerBlueprint = parseStoredBlueprint(version.blueprint);
    const renamed = newName !== undefined && newName !== blueprint.persona.name;
    if (renamed) {
      // The persona lives in the blueprint too; a PROPOSED, never-run version is the only kind we may still edit.
      if (version.lockedAt) throw new AppError("IMMUTABLE_VERSION", `Version ${version.version} has already run and can no longer be changed`);
      blueprint = { ...blueprint, persona: { ...blueprint.persona, name: newName } };
    }

    const now = new Date();
    const previous = worker.currentVersion;
    if (previous && previous.id !== version.id) {
      await tx.workerVersion.update({ where: { id: previous.id }, data: { status: "REPLACED", retiredAt: now } });
    }
    await tx.workerVersion.update({
      where: { id: version.id },
      data: { status: "ACTIVE", activatedAt: now, ...(renamed ? { blueprint: toJson(blueprint) } : {}) },
    });

    // A paused worker stays paused: its schedule fields update, but nothing is queued until it is resumed.
    const nextRunAt = worker.status === "ACTIVE" ? computeNextRunAt(blueprint.schedule, now) : null;
    await tx.worker.update({
      where: { id: worker.id },
      data: {
        currentVersionId: version.id,
        name: newName ?? worker.name,
        title: blueprint.persona.title,
        avatarColor: blueprint.persona.avatarColor,
        health: "UNKNOWN",
        healthReason: null,
        score: null,
        scoreUpdatedAt: null,
        ...cadenceToWorkerFields(blueprint.schedule),
        nextRunAt,
      },
    });

    const sync = await syncGrants(tx, {
      workerId: worker.id,
      previousTools: previousToolNames(previous?.blueprint),
      requirements: blueprint.tools,
      grantedById: s.userId,
      now,
    });

    return { version, previousName: worker.name, name: newName ?? worker.name, jobId: worker.jobId, workerId: worker.id, sync };
  });

  const { version } = activated;
  const title =
    version.changeReason === "REPLACEMENT"
      ? `${s.name} hired a replacement for ${activated.previousName}${activated.name !== activated.previousName ? ` — welcome ${activated.name}` : ""}`
      : `${s.name} updated how ${activated.name} works`;
  const detail = [
    `v${version.version}`,
    version.changeSummary ? clip(version.changeSummary, 200) : null,
    ...grantDetail(activated.sync),
    cancelledQueued > 0 ? `cancelled ${plural(cancelledQueued, "queued run")} of the previous version` : null,
  ]
    .filter((x): x is string => x !== null)
    .join(" · ");
  await recordActivity({
    organizationId: s.organizationId,
    type: "WORKER_REPLACED",
    title,
    detail,
    workerId: activated.workerId,
    jobId: activated.jobId,
    actorType: "USER",
    actorName: s.name,
    metadata: { versionId: version.id, version: version.version, changeReason: version.changeReason },
  });
}
