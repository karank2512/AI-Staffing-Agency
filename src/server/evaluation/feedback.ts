import { recordActivity } from "@/server/activity";
import type { SessionContext } from "@/server/auth/types";
import { db, toJson } from "@/server/db";
import type { EvaluationDetails } from "@/server/domain/evaluation";
import { invalid, notFound } from "@/server/errors";
import { refreshWorkerScore } from "./score";

/**
 * Human review of a deliverable — the "user" component of the worker score. Accepting or rejecting writes the
 * decision on the Deliverable and keeps exactly ONE USER_FEEDBACK evaluation per deliverable, so changing your
 * mind later updates the same row instead of double-counting.
 */

export type FeedbackDecision = "accept" | "reject";

export interface DeliverableFeedbackArgs {
  deliverableId: string;
  decision: FeedbackDecision;
  feedback?: string;
}

const MAX_FEEDBACK_CHARS = 4_000;

export async function recordDeliverableFeedback(s: SessionContext, args: DeliverableFeedbackArgs): Promise<void> {
  if (args.decision !== "accept" && args.decision !== "reject") throw invalid("Decision must be accept or reject");
  const feedback = args.feedback?.trim() || undefined;
  if (feedback && feedback.length > MAX_FEEDBACK_CHARS) {
    throw invalid(`Feedback must be at most ${MAX_FEEDBACK_CHARS.toLocaleString("en-US")} characters`);
  }

  const deliverable = await db.deliverable.findFirst({
    where: { id: args.deliverableId, organizationId: s.organizationId },
    select: {
      id: true,
      title: true,
      jobId: true,
      workerId: true,
      workerVersionId: true,
      runId: true,
      worker: { select: { name: true } },
    },
  });
  if (!deliverable) throw notFound("Deliverable");

  const accepted = args.decision === "accept";
  const now = new Date();
  const details: EvaluationDetails = {
    kind: "user_feedback",
    decision: accepted ? "accepted" : "rejected",
    ...(feedback ? { feedback } : {}),
  };
  const evaluation = {
    organizationId: s.organizationId,
    workerId: deliverable.workerId,
    workerVersionId: deliverable.workerVersionId,
    runId: deliverable.runId,
    score: accepted ? 1 : 0,
    passed: accepted,
    summary: `${accepted ? "Accepted" : "Rejected"} by ${s.name}${feedback ? `: ${feedback}` : ""}`,
    details: toJson(details),
    createdById: s.userId,
  };

  await db.$transaction(async (tx) => {
    await tx.deliverable.update({
      where: { id: deliverable.id },
      data: {
        status: accepted ? "ACCEPTED" : "REJECTED",
        feedback: feedback ?? null,
        reviewedById: s.userId,
        reviewedAt: now,
      },
    });
    await tx.evaluation.upsert({
      where: { deliverableId_type: { deliverableId: deliverable.id, type: "USER_FEEDBACK" } },
      create: { deliverableId: deliverable.id, type: "USER_FEEDBACK", ...evaluation, createdAt: now },
      update: { ...evaluation, createdAt: now },
    });
  });

  await refreshWorkerScore(deliverable.workerId);

  await recordActivity({
    organizationId: s.organizationId,
    type: accepted ? "DELIVERABLE_ACCEPTED" : "DELIVERABLE_REJECTED",
    title: `${s.name} ${accepted ? "accepted" : "sent back"} ${deliverable.worker.name}’s “${deliverable.title}”`,
    detail: feedback,
    workerId: deliverable.workerId,
    jobId: deliverable.jobId,
    runId: deliverable.runId,
    actorType: "USER",
    actorName: s.name,
    metadata: { deliverableId: deliverable.id },
  });
}
