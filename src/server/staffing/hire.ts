import { Prisma } from "@prisma/client";
import { recordActivity } from "@/server/activity";
import type { SessionContext } from "@/server/auth/types";
import { db, toJson } from "@/server/db";
import { cadenceToWorkerFields, computeNextRunAt, describeCadence, type WorkerBlueprint } from "@/server/domain";
import { conflict, errorMessage, invalid, notFound } from "@/server/errors";
import { enqueueRun } from "@/server/runtime";
import { tools } from "@/server/tools";
import { parseProposal, parseStoredSpec } from "./jobs";
import { avatarColorFor } from "./persona";

/**
 * hireWorker — the pending proposal becomes a real worker: Worker + WorkerVersion v1 (ACTIVE) + tool grants +
 * schedule, the job is STAFFED and the proposal cleared, all in one transaction. The first run is queued after
 * commit; a queueing failure is reported (runId undefined), never thrown, because the hire itself succeeded.
 */

const MAX_NAME_CHARS = 40;

function chosenName(requested: string | undefined, fallback: string): string {
  if (requested === undefined) return fallback;
  const clean = requested.replace(/\s+/g, " ").trim();
  if (clean.length === 0) return fallback;
  if (clean.length > MAX_NAME_CHARS) throw invalid(`Worker names are at most ${MAX_NAME_CHARS} characters.`);
  return clean;
}

/** A grant is at least as strict as the registry default: a tool that defaults to approval never loses it here. */
function grantRequiresApproval(toolName: string, fromBlueprint: boolean): boolean {
  return fromBlueprint || (tools.get(toolName)?.defaultRequiresApproval ?? false);
}

export async function hireWorker(
  s: SessionContext,
  jobId: string,
  opts: { name?: string; startFirstRun?: boolean } = {},
): Promise<{ workerId: string; versionId: string; runId?: string }> {
  const hired = await db.$transaction(async (tx) => {
    // Lock the job row so two "Hire" clicks cannot both pass the checks below and seat two workers.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Job" WHERE "id" = ${jobId} AND "organizationId" = ${s.organizationId} FOR UPDATE`;
    if (locked.length === 0) throw notFound("Job");
    const job = await tx.job.findUniqueOrThrow({ where: { id: jobId } });

    const seated = await tx.worker.count({ where: { jobId: job.id, status: { not: "RETIRED" } } });
    if (seated > 0) throw conflict("This job already has a worker. Retire or replace them instead of hiring another.");
    if (job.status !== "DRAFT" && job.status !== "SPEC_APPROVED") throw conflict("This job is not open for hiring.");

    const proposal = parseProposal(job.pendingProposal);
    if (!proposal) throw conflict("Generate a proposal before hiring.");
    const specRow = await tx.jobSpec.findFirst({ where: { id: proposal.jobSpecId, jobId: job.id, status: "APPROVED" } });
    if (!specRow) throw conflict("The proposal was designed for a spec that is no longer approved; regenerate it.");
    const spec = parseStoredSpec(specRow.spec);

    const name = chosenName(opts.name, proposal.blueprint.persona.name);
    // A renamed worker gets the color its new name hashes to, so the avatar stays a pure function of the name.
    const avatarColor = name === proposal.blueprint.persona.name ? proposal.blueprint.persona.avatarColor : avatarColorFor(name);
    const blueprint: WorkerBlueprint = { ...proposal.blueprint, persona: { ...proposal.blueprint.persona, name, avatarColor } };
    const now = new Date();
    const schedule = cadenceToWorkerFields(blueprint.schedule);

    const worker = await tx.worker.create({
      data: {
        organizationId: s.organizationId,
        jobId: job.id,
        name,
        title: blueprint.persona.title,
        avatarColor: blueprint.persona.avatarColor,
        status: "ACTIVE",
        health: "UNKNOWN",
        ...schedule,
        nextRunAt: computeNextRunAt(blueprint.schedule, now),
        hiredAt: now,
      },
    });
    const version = await tx.workerVersion.create({
      data: {
        workerId: worker.id,
        jobSpecId: specRow.id,
        version: 1,
        status: "ACTIVE",
        blueprint: toJson(blueprint),
        changeReason: "INITIAL_HIRE",
        changeSummary: proposal.rationale.join("\n") || null,
        activatedAt: now,
        createdById: s.userId,
      },
    });
    await tx.worker.update({ where: { id: worker.id }, data: { currentVersionId: version.id } });
    if (blueprint.tools.length > 0) {
      await tx.workerToolGrant.createMany({
        data: blueprint.tools.map((t) => ({
          workerId: worker.id,
          toolName: t.toolName,
          requiresApproval: grantRequiresApproval(t.toolName, t.requiresApproval),
          grantedById: s.userId,
        })),
      });
    }
    await tx.job.update({ where: { id: job.id }, data: { status: "STAFFED", pendingProposal: Prisma.DbNull } });

    await recordActivity(
      {
        organizationId: s.organizationId,
        type: "WORKER_HIRED",
        title: `You hired ${name} as ${blueprint.persona.title}`,
        detail: `${spec.title} · ${describeCadence(blueprint.schedule)} · est. $${blueprint.costEstimate.perRunUsd.toFixed(2)} per run`,
        workerId: worker.id,
        jobId: job.id,
        actorType: "USER",
        actorName: s.name,
        // No versionId on purpose: the feed would link to the version-compare page, and v1 has nothing to compare
        // against. Without it the link precedence lands on the worker profile.
        metadata: { version: 1, changeReason: "INITIAL_HIRE" },
      },
      tx,
    );

    return { workerId: worker.id, versionId: version.id };
  });

  if (opts.startFirstRun === false) return hired;

  try {
    const { runId } = await enqueueRun({ organizationId: s.organizationId, workerId: hired.workerId, trigger: "HIRE", requestedById: s.userId });
    return { ...hired, runId };
  } catch (e) {
    // The hire itself committed; a queue problem is reported to the caller as "no first run", never as a failed hire.
    console.error(`[staffing] hired worker ${hired.workerId} but could not queue the first run: ${errorMessage(e)}`);
    return hired;
  }
}
