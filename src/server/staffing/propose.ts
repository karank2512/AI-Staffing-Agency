import { assertCan } from "@/server/auth/permissions";
import type { SessionContext } from "@/server/auth/types";
import { db, toJson } from "@/server/db";
import { BlueprintDraftSchema, type BlueprintDraft, type JobSpec, type WorkerBlueprint, type WorkerProposal } from "@/server/domain";
import { conflict, errorMessage, isAppError } from "@/server/errors";
import { llm } from "@/server/models";
import { assertOrgActive, assertWithinBudget } from "@/server/security";
import { designBlueprint } from "./design";
import { getJob, latestOpenSpec, parseProposal, parseStoredSpec } from "./jobs";
import { normalizeBlueprintDraft } from "./normalize";
import { BLUEPRINT_SYSTEM, buildBlueprintPrompt } from "./prompts";
import { draftFromTemplate } from "./templates";

/**
 * proposeWorker — design a worker for the approved spec and park it on Job.pendingProposal until "Hire".
 * The model drafts; designBlueprint wires and validates; a live draft that cannot be wired falls back to the
 * job-family template so the flow never dead-ends on a bad model answer.
 */

async function usedWorkerNames(organizationId: string): Promise<string[]> {
  const workers = await db.worker.findMany({ where: { organizationId, status: { not: "RETIRED" } }, select: { name: true } });
  return workers.map((w) => w.name);
}

function designWithFallback(spec: JobSpec, draft: BlueprintDraft, usedNames: string[], simulated: boolean): { blueprint: WorkerBlueprint; draft: BlueprintDraft } {
  try {
    return { blueprint: designBlueprint(spec, draft, { usedNames }), draft };
  } catch (e) {
    // Only a live model can hand us an unwirable draft; the template is our own code, so its failure is a bug.
    if (simulated || !isAppError(e) || e.code !== "VALIDATION") throw e;
    console.warn(`[staffing] live blueprint draft for "${spec.title}" failed design validation, using the ${spec.jobFamily} template instead: ${errorMessage(e)}`);
    const fallback = draftFromTemplate(spec, { usedNames });
    return { blueprint: designBlueprint(spec, fallback, { usedNames }), draft: fallback };
  }
}

export async function proposeWorker(s: SessionContext, jobId: string, opts: { regenerate?: boolean } = {}): Promise<WorkerProposal> {
  assertCan(s, "jobs.manage");
  await assertOrgActive(s.organizationId);
  await assertWithinBudget(s.organizationId);
  const job = await getJob(s.organizationId, jobId);
  if (job.status !== "DRAFT" && job.status !== "SPEC_APPROVED") throw conflict("This job is already staffed.");
  // Same rule as getHireFlowState: the flow is at the proposal step only when the newest open spec is the approved one.
  // A revised draft on top of an older approved spec means the customer is still editing — design nothing yet.
  const specRow = await latestOpenSpec(job.id);
  if (!specRow || specRow.status !== "APPROVED") throw conflict("Approve the job spec before designing a worker.");
  const spec = parseStoredSpec(specRow.spec);

  if (!opts.regenerate) {
    const existing = parseProposal(job.pendingProposal, specRow.id);
    if (existing) return existing;
  }

  const usedNames = await usedWorkerNames(s.organizationId);
  const result = await llm.generateObject(
    {
      tier: "standard",
      system: BLUEPRINT_SYSTEM,
      prompt: buildBlueprintPrompt(spec, usedNames),
      schema: BlueprintDraftSchema,
      schemaName: "BlueprintDraft",
      normalize: normalizeBlueprintDraft,
      mock: () => draftFromTemplate(spec, { usedNames }),
    },
    { organizationId: s.organizationId, jobId: job.id, purpose: "staffing.blueprint" },
  );

  const { blueprint, draft } = designWithFallback(spec, result.object, usedNames, result.simulated);
  const rationale = draft.rationale.map((r) => r.trim()).filter((r) => r.length > 0);
  const proposal: WorkerProposal = {
    jobSpecId: specRow.id,
    blueprint,
    rationale: rationale.length > 0 ? rationale : draftFromTemplate(spec, { usedNames }).rationale,
    simulated: result.simulated,
    generatedAt: new Date().toISOString(),
  };

  await db.job.updateMany({ where: { id: job.id, organizationId: s.organizationId }, data: { pendingProposal: toJson(proposal) } });
  return proposal;
}
