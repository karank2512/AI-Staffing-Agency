"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/action-result";
import { requireSession } from "@/server/auth";
import { cancelRun, decideApproval, retryRun } from "@/server/runtime";
import { DecisionSchema, limitRunAction, NoteSchema, parseId, parseOptionalId } from "../../_lib/action-guards";

/**
 * Server actions for /runs/[runId]. Each one: requireSession → validate → runtime call → revalidate the pages
 * that show this run (the run itself, its worker's profile, the approvals inbox and the workforce overview).
 * Roles are enforced inside the runtime (workers.run for cancel/retry, approvals.decide for a decision).
 */

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
    const id = parseId(runId, "Run");
    await cancelRun(s, id);
    revalidateRun(id, parseOptionalId(workerId));
  });
}

/** Retry creates a NEW run; the client navigates to it. */
export async function retryRunAction(runId: string, workerId?: string): Promise<ActionResult<{ redirectTo: string; runId: string }>> {
  return runAction(async () => {
    const s = await requireSession();
    await limitRunAction(s);
    const id = parseId(runId, "Run");
    const { runId: newRunId } = await retryRun(s, id);
    revalidateRun(id, parseOptionalId(workerId));
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
    const id = parseId(runId, "Run");
    const approval = parseId(approvalId, "Approval request");
    await decideApproval({
      organizationId: s.organizationId,
      approvalId: approval,
      userId: s.userId,
      decision: DecisionSchema.parse(decision),
      note: NoteSchema.parse(note),
    });
    revalidateRun(id, parseOptionalId(workerId));
  });
}
