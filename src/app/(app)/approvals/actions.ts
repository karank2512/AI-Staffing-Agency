"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/action-result";
import { requireSession } from "@/server/auth";
import { getApprovalRefs } from "@/server/queries/approvals";
import { decideApproval } from "@/server/runtime";
import { DecisionInputSchema, type Decision } from "./schema";

/**
 * Approve or reject a pending request. Used by /approvals and by the "Needs your attention" strip on /workforce,
 * so every surface that shows the request (or the run it pauses) is revalidated here.
 */
export async function decideApprovalAction(
  approvalId: string,
  decision: Decision,
  note?: string,
): Promise<ActionResult<{ workerName: string | null }>> {
  return runAction(async () => {
    const s = await requireSession();
    const input = DecisionInputSchema.parse({ approvalId, decision, note });
    // Looked up before the decision: it is org-scoped, so a foreign id simply yields no pages to revalidate
    // (decideApproval itself rejects it with NOT_FOUND).
    const refs = await getApprovalRefs(s.organizationId, input.approvalId);
    await decideApproval({
      organizationId: s.organizationId,
      approvalId: input.approvalId,
      userId: s.userId,
      decision: input.decision,
      note: input.note,
    });
    revalidatePath("/approvals");
    revalidatePath("/workforce");
    revalidatePath("/activity");
    if (refs) {
      revalidatePath(`/runs/${refs.runId}`);
      revalidatePath(`/workers/${refs.workerId}`);
    }
    return { workerName: refs?.workerName ?? null };
  });
}
