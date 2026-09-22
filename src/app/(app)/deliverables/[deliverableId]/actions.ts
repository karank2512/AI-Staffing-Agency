"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/action-result";
import { requireSession } from "@/server/auth";
import { invalid } from "@/server/errors";
import { recordDeliverableFeedback } from "@/server/evaluation";

/** Accept / reject a deliverable with optional feedback. Re-deciding later updates the same review. */
export async function reviewDeliverableAction(
  deliverableId: string,
  decision: "accept" | "reject",
  feedback?: string,
  context?: { runId?: string; workerId?: string },
): Promise<ActionResult> {
  return runAction(async () => {
    const s = await requireSession();
    if (decision !== "accept" && decision !== "reject") throw invalid("Decision must be accept or reject");
    await recordDeliverableFeedback(s, { deliverableId, decision, feedback: feedback?.trim() || undefined });
    revalidatePath(`/deliverables/${deliverableId}`);
    revalidatePath("/deliverables");
    revalidatePath("/workforce");
    revalidatePath("/activity");
    if (context?.runId) revalidatePath(`/runs/${context.runId}`);
    if (context?.workerId) revalidatePath(`/workers/${context.workerId}`);
  });
}
