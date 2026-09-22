"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/action-result";
import { requireSession } from "@/server/auth";
import { invalid } from "@/server/errors";
import { cancelRun, decideApproval, retryRun } from "@/server/runtime";

/**
 * Server actions for /runs/[runId]. Each one: requireSession → runtime call → revalidate the pages that show
 * this run (the run itself, its worker's profile, the approvals inbox and the workforce overview).
 */

const MAX_NOTE_CHARS = 1_000;

function revalidateRun(runId: string, workerId?: string) {
  revalidatePath(`/runs/${runId}`);
  revalidatePath("/runs");
  revalidatePath("/approvals");
  revalidatePath("/workforce");
  revalidatePath("/activity");
  if (workerId) revalidatePath(`/workers/${workerId}`);
}

export async function cancelRunAction(runId: string, workerId?: string): Promise<ActionResult> {
  return runAction(async () => {
    const s = await requireSession();
    await cancelRun(s, runId);
    revalidateRun(runId, workerId);
  });
}

/** Retry creates a NEW run; the client navigates to it. */
export async function retryRunAction(runId: string, workerId?: string): Promise<ActionResult<{ redirectTo: string; runId: string }>> {
  return runAction(async () => {
    const s = await requireSession();
    const { runId: newRunId } = await retryRun(s, runId);
    revalidateRun(runId, workerId);
    revalidatePath(`/runs/${newRunId}`);
    return { redirectTo: `/runs/${newRunId}`, runId: newRunId };
  });
}

export async function decideApprovalAction(
  runId: string,
  approvalId: string,
  decision: "approve" | "reject",
  note?: string,
  workerId?: string,
): Promise<ActionResult> {
  return runAction(async () => {
    const s = await requireSession();
    if (decision !== "approve" && decision !== "reject") throw invalid("Decision must be approve or reject");
    const trimmed = note?.trim() || undefined;
    if (trimmed && trimmed.length > MAX_NOTE_CHARS) throw invalid(`Notes must be at most ${MAX_NOTE_CHARS} characters`);
    await decideApproval({ organizationId: s.organizationId, approvalId, userId: s.userId, decision, note: trimmed });
    revalidateRun(runId, workerId);
  });
}
