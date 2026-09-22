import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { cancelRun, cancelWorkerRuns, decideApproval, executeRun } from "@/server/runtime";
import { createTestOrg } from "../helpers/factory";
import { createHiredWorker } from "../helpers/fixtures";
import { activityTypes, checkpointOf, enqueue, loadRun, stepsOf, type Hired, type TestOrg } from "./helpers";

async function runUntilPaused(t: TestOrg, hired: Hired) {
  const runId = await enqueue(t, hired);
  const outcome = await executeRun(runId);
  expect(outcome.status).toBe("WAITING_FOR_APPROVAL");
  if (outcome.status !== "WAITING_FOR_APPROVAL") throw new Error("unreachable");
  expect(outcome.approvalIds).toHaveLength(1);
  const approval = await db.approval.findUniqueOrThrow({ where: { id: outcome.approvalIds[0] } });
  return { runId, approval };
}

const sendCalls = (runId: string) => db.toolCall.findMany({ where: { runId, toolName: "send_notification" }, orderBy: { createdAt: "asc" } });

describe("runtime: approval flow", () => {
  let t: TestOrg;
  let hired: Hired;
  beforeAll(async () => {
    t = await createTestOrg("rt-approvals");
    hired = await createHiredWorker(t.organization.id, { withNotifier: true });
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it("pauses for approval with the deliverable already made, then approve → resume → the send happens exactly once", async () => {
    const { runId, approval } = await runUntilPaused(t, hired);

    // Paused state: one PENDING approval, run released, checkpoint holds the pending call, deliverable exists.
    const paused = await loadRun(runId);
    expect(paused).toMatchObject({ status: "WAITING_FOR_APPROVAL", lockedBy: null, heartbeatAt: null });
    expect(approval).toMatchObject({ status: "PENDING", toolName: "send_notification", organizationId: t.organization.id, workerId: hired.worker.id, runId });
    expect(approval.title.length).toBeGreaterThan(5);
    expect(approval.payload).toMatchObject({ channel: "email", recipients: expect.any(Array) });
    const cp = checkpointOf(paused);
    expect(cp.agent?.componentId).toBe("notifier");
    expect(cp.agent?.pendingToolCalls).toHaveLength(1);
    expect(cp.agent?.pendingToolCalls[0]).toMatchObject({ toolCallId: approval.toolCallId, toolName: "send_notification" });
    expect(cp.agent?.messages.at(-1)?.role).toBe("assistant");
    expect(cp.deliverableId).toBeDefined();
    expect(cp.componentIndex).toBe(hired.blueprint.components.length - 1);
    expect(await db.deliverable.count({ where: { runId } })).toBe(1);
    expect(await db.approval.count({ where: { runId, status: "PENDING" } })).toBe(1);

    let calls = await sendCalls(runId);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ status: "PENDING_APPROVAL", runStepId: expect.any(String) });
    let steps = await stepsOf(runId);
    const approvalStep = steps.find((s) => s.kind === "APPROVAL");
    expect(approvalStep).toMatchObject({ status: "WAITING", title: approval.title, componentId: "notifier", input: { approvalId: approval.id, toolCallId: approval.toolCallId } });
    expect(steps.find((s) => s.id === calls[0].runStepId)?.status).toBe("PENDING");
    expect(steps.find((s) => s.kind === "DELIVERABLE")?.status).toBe("SUCCEEDED");
    let types = await activityTypes(t.organization.id, runId);
    expect(types).toContain("DELIVERABLE_CREATED");
    expect(types.at(-1)).toBe("APPROVAL_REQUESTED");
    const requested = await db.activityEvent.findFirstOrThrow({ where: { runId, type: "APPROVAL_REQUESTED" } });
    expect(requested.metadata).toMatchObject({ approvalId: approval.id, toolName: "send_notification" });

    // Executing a WAITING run is a no-op that reports the pending approvals.
    expect(await executeRun(runId)).toEqual({ status: "WAITING_FOR_APPROVAL", approvalIds: [approval.id] });
    expect((await stepsOf(runId)).length).toBe(steps.length);

    // Approve → QUEUED, tool call APPROVED, APPROVAL step SUCCEEDED.
    await decideApproval({ organizationId: t.organization.id, approvalId: approval.id, userId: t.user.id, decision: "approve", note: "Looks good" });
    expect((await loadRun(runId)).status).toBe("QUEUED");
    expect(await db.approval.findUniqueOrThrow({ where: { id: approval.id } })).toMatchObject({ status: "APPROVED", decidedById: t.user.id, decisionNote: "Looks good" });
    expect((await sendCalls(runId))[0].status).toBe("APPROVED");
    expect((await db.runStep.findUniqueOrThrow({ where: { id: approvalStep!.id } })).status).toBe("SUCCEEDED");
    expect((await activityTypes(t.organization.id, runId)).at(-1)).toBe("APPROVAL_APPROVED");

    // Resume → the notification goes out once and the run finishes.
    const resumed = await executeRun(runId);
    expect(resumed.status).toBe("SUCCEEDED");
    const done = await loadRun(runId);
    expect(done).toMatchObject({ status: "SUCCEEDED", attempt: 1 });
    calls = await sendCalls(runId);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ status: "SUCCEEDED", attempt: 1 });
    expect(calls[0].output).toMatchObject({ delivered: true, simulated: true });
    steps = await stepsOf(runId);
    expect(steps.find((s) => s.id === calls[0].runStepId)?.status).toBe("SUCCEEDED");
    expect(new Set(steps.map((s) => s.index)).size).toBe(steps.length);
    expect(steps.some((s) => ["RUNNING", "PENDING", "WAITING"].includes(s.status))).toBe(false);
    const cpDone = checkpointOf(done);
    expect(cpDone.agent).toBeUndefined();
    expect(cpDone.componentIndex).toBe(hired.blueprint.components.length);
    expect(String(cpDone.context.notification_status)).toMatch(/^Sent /);
    // Active time excludes the approval wait: the run "took" well under the seconds we spent here.
    expect(done.durationMs).toBeLessThan(20_000);
    types = await activityTypes(t.organization.id, runId);
    expect(types).toContain("TOOL_USED");
    expect(types.at(-1)).toBe("RUN_SUCCEEDED");
    expect(await db.evaluation.count({ where: { runId } })).toBe(2);

    // A third execution changes nothing.
    expect(await executeRun(runId)).toEqual({ status: "SUCCEEDED", deliverableIds: [cpDone.deliverableId] });
    expect(await sendCalls(runId)).toHaveLength(1);
    expect((await stepsOf(runId)).length).toBe(steps.length);
    expect(types).toEqual(await activityTypes(t.organization.id, runId));
  });

  it("reject → the run continues and finishes without sending; the tool call is DENIED", async () => {
    const { runId, approval } = await runUntilPaused(t, hired);
    await decideApproval({ organizationId: t.organization.id, approvalId: approval.id, userId: t.user.id, decision: "reject", note: "Not this week" });
    expect((await loadRun(runId)).status).toBe("QUEUED");
    expect((await db.approval.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("REJECTED");
    const approvalStep = (await stepsOf(runId)).find((s) => s.kind === "APPROVAL");
    expect(approvalStep).toMatchObject({ status: "FAILED", detail: `Rejected by ${t.user.name}` });
    expect((await activityTypes(t.organization.id, runId)).at(-1)).toBe("APPROVAL_REJECTED");

    const outcome = await executeRun(runId);
    expect(outcome.status).toBe("SUCCEEDED");
    const calls = await sendCalls(runId);
    expect(calls).toHaveLength(1);
    expect(calls[0].status).toBe("DENIED");
    expect(calls[0].error).toContain("Not this week");
    const steps = await stepsOf(runId);
    expect(steps.find((s) => s.id === calls[0].runStepId)?.status).toBe("FAILED");
    const notificationStatus = String(checkpointOf(await loadRun(runId)).context.notification_status);
    expect(notificationStatus).toMatch(/could not be sent/);
    expect(await activityTypes(t.organization.id, runId)).not.toContain("TOOL_USED");
    expect(await db.evaluation.count({ where: { runId } })).toBe(2);
  });

  it("cancelRun while WAITING expires the approval, denies the tool call and refuses any later decision", async () => {
    const { runId, approval } = await runUntilPaused(t, hired);
    await cancelRun(t.session, runId);
    const run = await loadRun(runId);
    expect(run.status).toBe("CANCELLED");
    expect(run.durationMs).toBeGreaterThanOrEqual(0);
    expect((await db.approval.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("EXPIRED");
    expect((await sendCalls(runId))[0].status).toBe("DENIED");
    const steps = await stepsOf(runId);
    expect(steps.find((s) => s.kind === "APPROVAL")?.status).toBe("SKIPPED");
    expect(steps.some((s) => ["RUNNING", "PENDING", "WAITING"].includes(s.status))).toBe(false);
    expect((await activityTypes(t.organization.id, runId)).at(-1)).toBe("RUN_CANCELLED");

    await expect(decideApproval({ organizationId: t.organization.id, approvalId: approval.id, userId: t.user.id, decision: "approve" })).rejects.toSatisfy(
      (e: unknown) => e instanceof AppError && e.code === "CONFLICT",
    );
    expect(await executeRun(runId)).toEqual({ status: "CANCELLED" });
    expect(await sendCalls(runId)).toHaveLength(1);
  });

  it("a decision on a request whose run moved on marks it EXPIRED and conflicts; unknown ids are NOT_FOUND", async () => {
    const { runId, approval } = await runUntilPaused(t, hired);
    // Simulate the run having been re-queued elsewhere while the request still shows as pending.
    await db.run.update({ where: { id: runId }, data: { status: "QUEUED" } });
    await expect(decideApproval({ organizationId: t.organization.id, approvalId: approval.id, userId: t.user.id, decision: "approve" })).rejects.toSatisfy(
      (e: unknown) => e instanceof AppError && e.code === "CONFLICT",
    );
    expect((await db.approval.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("EXPIRED");
    await db.run.update({ where: { id: runId }, data: { status: "CANCELLED", finishedAt: new Date() } });

    await expect(decideApproval({ organizationId: t.organization.id, approvalId: "apr_missing", userId: t.user.id, decision: "approve" })).rejects.toSatisfy(
      (e: unknown) => e instanceof AppError && e.code === "NOT_FOUND",
    );
  });

  it("is org-scoped: another organization can neither see nor decide the request, and cancelWorkerRuns clears WAITING runs", async () => {
    const other = await createTestOrg("rt-approvals-other");
    try {
      const { runId, approval } = await runUntilPaused(t, hired);
      await expect(decideApproval({ organizationId: other.organization.id, approvalId: approval.id, userId: other.user.id, decision: "approve" })).rejects.toSatisfy(
        (e: unknown) => e instanceof AppError && e.code === "NOT_FOUND",
      );
      expect((await db.approval.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("PENDING");

      expect(await cancelWorkerRuns(t.organization.id, hired.worker.id, ["WAITING_FOR_APPROVAL"])).toBe(1);
      expect((await loadRun(runId)).status).toBe("CANCELLED");
      expect((await db.approval.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("EXPIRED");
    } finally {
      await other.cleanup();
    }
  });
});
