"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/action-result";
import { requireSession } from "@/server/auth";
import { recordDeliverableFeedback } from "@/server/evaluation";
import { FeedbackSchema, parseId, parseOptionalId, ReviewDecisionSchema } from "../../_lib/action-guards";

/**
 * Accept / reject a deliverable with optional feedback. Re-deciding later updates the same review.
 * `deliverables.review` is enforced inside the evaluation module.
 */
export async function reviewDeliverableAction(
  deliverableId: string,
  decision: "accept" | "reject",
  feedback?: string,
  context?: { runId?: string; workerId?: string },
): Promise<ActionResult> {
  return runAction(async () => {
    const s = await requireSession();
    const id = parseId(deliverableId, "Deliverable");
    await recordDeliverableFeedback(s, {
      deliverableId: id,
      decision: ReviewDecisionSchema.parse(decision),
      feedback: FeedbackSchema.parse(feedback),
    });
    revalidatePath(`/deliverables/${id}`);
    revalidatePath("/deliverables");
    revalidatePath("/workforce");
    revalidatePath("/activity");
    // Only ever used to refresh extra pages: an unusable id is dropped rather than failing the review.
    const runId = parseOptionalId(context?.runId);
    const workerId = parseOptionalId(context?.workerId);
    if (runId) revalidatePath(`/runs/${runId}`);
    if (workerId) revalidatePath(`/workers/${workerId}`);
  });
}
