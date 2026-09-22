"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/action-result";
import { requireSession } from "@/server/auth";
import { getHiredWorkerSummary } from "@/server/queries/hire";
import {
  approveJobSpec,
  buildJobSpec,
  discardJob,
  hireWorker,
  proposeWorker,
  reviseJobSpec,
  scopeJob,
  updateJobSpec,
} from "@/server/staffing";
import { AnswersSchema, HireInputSchema, ScopeJobInputSchema, SpecPatchSchema, toSpecPatch, type SpecPatch } from "./schema";

/**
 * Server actions for /hire. Every action: requireSession → validate → staffing call → revalidate. Results are
 * plain JSON; the client toasts errors and navigates on `redirectTo`.
 */

/** The hire flow, the jobs list and the job detail all show this job's progress. */
function revalidateJob(jobId?: string) {
  revalidatePath("/hire");
  revalidatePath("/jobs");
  if (jobId) revalidatePath(`/jobs/${jobId}`);
}

export async function scopeJobAction(description: string): Promise<ActionResult<{ redirectTo: string; jobId: string; questionCount: number }>> {
  return runAction(async () => {
    const s = await requireSession();
    const text = ScopeJobInputSchema.parse(description);
    const { jobId, questions } = await scopeJob(s, text);
    revalidateJob(jobId);
    return { redirectTo: `/hire?jobId=${encodeURIComponent(jobId)}`, jobId, questionCount: questions.questions.length };
  });
}

export async function buildJobSpecAction(jobId: string, answers: Record<string, string>): Promise<ActionResult<{ title: string }>> {
  return runAction(async () => {
    const s = await requireSession();
    const clean = AnswersSchema.parse(answers);
    const { spec } = await buildJobSpec(s, jobId, clean);
    revalidateJob(jobId);
    return { title: spec.title };
  });
}

export async function updateJobSpecAction(jobId: string, jobSpecId: string, patch: SpecPatch): Promise<ActionResult<{ title: string }>> {
  return runAction(async () => {
    const s = await requireSession();
    const clean = SpecPatchSchema.parse(patch);
    const spec = await updateJobSpec(s, jobSpecId, toSpecPatch(clean));
    revalidateJob(jobId);
    return { title: spec.title };
  });
}

/** "Approve spec": approval and worker design happen in one round-trip so the customer sees a single pending state. */
export async function approveSpecAndProposeAction(jobId: string, jobSpecId: string): Promise<ActionResult<{ workerName: string }>> {
  return runAction(async () => {
    const s = await requireSession();
    await approveJobSpec(s, jobSpecId);
    const proposal = await proposeWorker(s, jobId);
    revalidateJob(jobId);
    return { workerName: proposal.blueprint.persona.name };
  });
}

/** Resume (proposal missing) or "Regenerate proposal". Without `regenerate` the stored proposal is returned as is. */
export async function proposeWorkerAction(jobId: string, opts: { regenerate?: boolean } = {}): Promise<ActionResult<{ workerName: string }>> {
  return runAction(async () => {
    const s = await requireSession();
    const proposal = await proposeWorker(s, jobId, { regenerate: opts.regenerate === true });
    revalidateJob(jobId);
    return { workerName: proposal.blueprint.persona.name };
  });
}

/** "Back to spec" from the proposal: clones the approved spec into a new editable draft. */
export async function reviseJobSpecAction(jobId: string): Promise<ActionResult> {
  return runAction(async () => {
    const s = await requireSession();
    await reviseJobSpec(s, jobId);
    revalidateJob(jobId);
  });
}

export async function discardJobAction(jobId: string): Promise<ActionResult<{ redirectTo: string }>> {
  return runAction(async () => {
    const s = await requireSession();
    await discardJob(s, jobId);
    revalidateJob(jobId);
    return { redirectTo: "/hire" };
  });
}

export async function hireWorkerAction(
  jobId: string,
  input: { name?: string } = {},
): Promise<ActionResult<{ redirectTo: string; workerId: string; workerName: string; firstRunQueued: boolean }>> {
  return runAction(async () => {
    const s = await requireSession();
    const { name } = HireInputSchema.parse(input);
    const hired = await hireWorker(s, jobId, name ? { name } : {});
    const summary = await getHiredWorkerSummary(s.organizationId, hired.workerId);
    revalidateJob(jobId);
    revalidatePath("/workforce");
    revalidatePath(`/workers/${hired.workerId}`);
    return {
      redirectTo: `/workers/${hired.workerId}`,
      workerId: hired.workerId,
      workerName: summary?.name ?? name ?? "your new worker",
      firstRunQueued: hired.runId !== undefined,
    };
  });
}
