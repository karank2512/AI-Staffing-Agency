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
import { limitLlmAction, limitRunAction, parseId } from "../_lib/action-guards";
import { AnswersSchema, HireInputSchema, ScopeJobInputSchema, SpecPatchSchema, toSpecPatch, type SpecPatch } from "./schema";

/**
 * Server actions for /hire. Every action: requireSession → rate limit → validate → staffing call → revalidate.
 * Results are plain JSON; the client toasts errors and navigates on `redirectTo`. Role checks (jobs.manage /
 * workers.hire) live inside the staffing module, so no caller can skip them.
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
    await limitLlmAction(s);
    const text = ScopeJobInputSchema.parse(description);
    const { jobId, questions } = await scopeJob(s, text);
    revalidateJob(jobId);
    return { redirectTo: `/hire?jobId=${encodeURIComponent(jobId)}`, jobId, questionCount: questions.questions.length };
  });
}

export async function buildJobSpecAction(jobId: string, answers: Record<string, string>): Promise<ActionResult<{ title: string }>> {
  return runAction(async () => {
    const s = await requireSession();
    await limitLlmAction(s);
    const id = parseId(jobId, "Job");
    const clean = AnswersSchema.parse(answers);
    const { spec } = await buildJobSpec(s, id, clean);
    revalidateJob(id);
    return { title: spec.title };
  });
}

export async function updateJobSpecAction(jobId: string, jobSpecId: string, patch: SpecPatch): Promise<ActionResult<{ title: string }>> {
  return runAction(async () => {
    const s = await requireSession();
    const id = parseId(jobId, "Job");
    const specId = parseId(jobSpecId, "Job spec");
    const clean = SpecPatchSchema.parse(patch);
    const spec = await updateJobSpec(s, specId, toSpecPatch(clean));
    revalidateJob(id);
    return { title: spec.title };
  });
}

/** "Approve spec": approval and worker design happen in one round-trip so the customer sees a single pending state. */
export async function approveSpecAndProposeAction(jobId: string, jobSpecId: string): Promise<ActionResult<{ workerName: string }>> {
  return runAction(async () => {
    const s = await requireSession();
    await limitLlmAction(s);
    const id = parseId(jobId, "Job");
    const specId = parseId(jobSpecId, "Job spec");
    await approveJobSpec(s, specId);
    const proposal = await proposeWorker(s, id);
    revalidateJob(id);
    return { workerName: proposal.blueprint.persona.name };
  });
}

/** Resume (proposal missing) or "Regenerate proposal". Without `regenerate` the stored proposal is returned as is. */
export async function proposeWorkerAction(jobId: string, opts: { regenerate?: boolean } = {}): Promise<ActionResult<{ workerName: string }>> {
  return runAction(async () => {
    const s = await requireSession();
    const id = parseId(jobId, "Job");
    // Regenerating is the expensive path; returning the stored proposal is a read.
    if (opts.regenerate === true) await limitLlmAction(s);
    const proposal = await proposeWorker(s, id, { regenerate: opts.regenerate === true });
    revalidateJob(id);
    return { workerName: proposal.blueprint.persona.name };
  });
}

/** "Back to spec" from the proposal: clones the approved spec into a new editable draft. */
export async function reviseJobSpecAction(jobId: string): Promise<ActionResult> {
  return runAction(async () => {
    const s = await requireSession();
    const id = parseId(jobId, "Job");
    await reviseJobSpec(s, id);
    revalidateJob(id);
  });
}

export async function discardJobAction(jobId: string): Promise<ActionResult<{ redirectTo: string }>> {
  return runAction(async () => {
    const s = await requireSession();
    const id = parseId(jobId, "Job");
    await discardJob(s, id);
    revalidateJob(id);
    return { redirectTo: "/hire" };
  });
}

export async function hireWorkerAction(
  jobId: string,
  input: { name?: string } = {},
): Promise<ActionResult<{ redirectTo: string; workerId: string; workerName: string; firstRunQueued: boolean }>> {
  return runAction(async () => {
    const s = await requireSession();
    // A hire queues the new worker's first run, so it counts against the run budget.
    await limitRunAction(s);
    const id = parseId(jobId, "Job");
    const { name } = HireInputSchema.parse(input);
    const hired = await hireWorker(s, id, name ? { name } : {});
    const summary = await getHiredWorkerSummary(s.organizationId, hired.workerId);
    revalidateJob(id);
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
