import { recordActivity } from "@/server/activity";
import { db, toJson } from "@/server/db";
import { conflict, notFound } from "@/server/errors";
import { transitionRun } from "./transitions";
import type { DecideApprovalArgs } from "./types";

/**
 * A human decision on a paused run. Everything happens in one transaction so the approval, its tool call, the
 * APPROVAL step and the run status can never disagree; the run is re-queued only once no PENDING approval is left.
 */

export const DECLINED_MESSAGE = "A reviewer declined this request";
const STALE_MESSAGE = "This request is no longer awaiting a decision";

function stepApprovalId(input: unknown): string | undefined {
  const id = (input as { approvalId?: unknown } | null)?.approvalId;
  return typeof id === "string" ? id : undefined;
}

const APPROVAL_SELECT = {
  id: true,
  status: true,
  title: true,
  toolName: true,
  toolCallId: true,
  runId: true,
  workerId: true,
  run: { select: { status: true, jobId: true } },
  worker: { select: { name: true } },
} as const;

type Outcome =
  | { kind: "missing" }
  /** The run moved on (cancelled, failed, already resumed): the request can never be honoured. */
  | { kind: "stale"; approvalId: string; stillPending: boolean }
  | { kind: "decided"; approval: { id: string; title: string; toolName: string; runId: string; workerId: string; run: { jobId: string }; worker: { name: string } } };

export async function decideApproval(args: DecideApprovalArgs): Promise<void> {
  const { organizationId, approvalId, userId, decision } = args;
  const user = await db.user.findFirst({ where: { id: userId, organizationId }, select: { name: true } });
  if (!user) throw notFound("User");
  const now = new Date();
  const note = args.note?.trim() || undefined;

  // Throwing inside the transaction would roll back every write in it, so the outcome is returned and acted on after.
  const outcome = await db.$transaction(async (tx): Promise<Outcome> => {
    const approval = await tx.approval.findFirst({ where: { id: approvalId, organizationId }, select: APPROVAL_SELECT });
    if (!approval) return { kind: "missing" };
    if (approval.status !== "PENDING" || approval.run.status !== "WAITING_FOR_APPROVAL") {
      return { kind: "stale", approvalId: approval.id, stillPending: approval.status === "PENDING" };
    }

    const approved = decision === "approve";
    await tx.approval.update({
      where: { id: approval.id },
      data: { status: approved ? "APPROVED" : "REJECTED", decidedById: userId, decidedAt: now, decisionNote: note ?? null },
    });
    await tx.toolCall.update({
      where: { id: approval.toolCallId },
      data: approved
        ? { status: "APPROVED" }
        : { status: "DENIED", error: note ? `${DECLINED_MESSAGE}: ${note}` : DECLINED_MESSAGE, finishedAt: now },
    });

    const waitingSteps = await tx.runStep.findMany({
      where: { runId: approval.runId, kind: "APPROVAL", status: "WAITING" },
      select: { id: true, input: true, startedAt: true },
    });
    const step = waitingSteps.find((s) => stepApprovalId(s.input) === approval.id);
    if (step) {
      await tx.runStep.update({
        where: { id: step.id },
        data: {
          status: approved ? "SUCCEEDED" : "FAILED",
          finishedAt: now,
          durationMs: Math.max(0, now.getTime() - step.startedAt.getTime()),
          detail: `${approved ? "Approved" : "Rejected"} by ${user.name}`,
          output: toJson({ decision, decidedBy: user.name, note }),
          error: approved ? null : DECLINED_MESSAGE,
        },
      });
    }

    const remaining = await tx.approval.count({ where: { runId: approval.runId, status: "PENDING" } });
    if (remaining === 0) {
      await transitionRun(approval.runId, "QUEUED", { availableAt: now }, { tx });
    }
    return { kind: "decided", approval };
  });

  if (outcome.kind === "missing") throw notFound("Approval request");
  if (outcome.kind === "stale") {
    // Retire a request that can no longer be honoured so it stops showing up as pending.
    if (outcome.stillPending) {
      await db.approval.updateMany({
        where: { id: outcome.approvalId, status: "PENDING" },
        data: { status: "EXPIRED", decidedAt: now, decisionNote: STALE_MESSAGE },
      });
    }
    throw conflict(STALE_MESSAGE);
  }

  const decided = outcome.approval;
  await recordActivity({
    organizationId,
    type: decision === "approve" ? "APPROVAL_APPROVED" : "APPROVAL_REJECTED",
    title: `${user.name} ${decision === "approve" ? "approved" : "declined"} ${decided.worker.name}’s request`,
    detail: note ? `${decided.title} · “${note}”` : decided.title,
    workerId: decided.workerId,
    jobId: decided.run.jobId,
    runId: decided.runId,
    actorType: "USER",
    actorName: user.name,
    metadata: { approvalId: decided.id, toolName: decided.toolName },
  });
}
