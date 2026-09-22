import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { canTransition, isTerminal, RUN_TRANSITIONS, transitionRun } from "@/server/runtime";
import { createTestOrg } from "../helpers/factory";
import { createHiredWorker } from "../helpers/fixtures";
import { enqueue, loadRun, type Hired, type TestOrg } from "./helpers";

async function expectInvalid(p: Promise<unknown>) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "INVALID_TRANSITION");
}

describe("runtime: run state machine", () => {
  let t: TestOrg;
  let hired: Hired;

  beforeAll(async () => {
    t = await createTestOrg("rt-state");
    hired = await createHiredWorker(t.organization.id);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it("exposes the transition table and terminal statuses", () => {
    expect(canTransition("QUEUED", "RUNNING")).toBe(true);
    expect(canTransition("RUNNING", "QUEUED")).toBe(true);
    expect(canTransition("WAITING_FOR_APPROVAL", "QUEUED")).toBe(true);
    expect(canTransition("QUEUED", "SUCCEEDED")).toBe(false);
    expect(canTransition("SUCCEEDED", "QUEUED")).toBe(false);
    expect(RUN_TRANSITIONS.FAILED).toEqual([]);
    expect(isTerminal("CANCELLED")).toBe(true);
    expect(isTerminal("WAITING_FOR_APPROVAL")).toBe(false);
  });

  it("walks QUEUED → RUNNING → WAITING_FOR_APPROVAL → QUEUED → RUNNING → SUCCEEDED and rejects invalid moves", async () => {
    const runId = await enqueue(t, hired);

    await expectInvalid(transitionRun(runId, "SUCCEEDED"));
    await expectInvalid(transitionRun(runId, "WAITING_FOR_APPROVAL"));

    await transitionRun(runId, "RUNNING", { lockedBy: "exec-a", lockedAt: new Date(), heartbeatAt: new Date(), startedAt: new Date() });
    expect((await loadRun(runId)).lockedBy).toBe("exec-a");

    await transitionRun(runId, "WAITING_FOR_APPROVAL");
    let run = await loadRun(runId);
    expect(run.status).toBe("WAITING_FOR_APPROVAL");
    // Leaving RUNNING releases the lease.
    expect(run.lockedBy).toBeNull();
    expect(run.lockedAt).toBeNull();
    expect(run.heartbeatAt).toBeNull();

    await expectInvalid(transitionRun(runId, "RUNNING"));
    await expectInvalid(transitionRun(runId, "SUCCEEDED"));

    await transitionRun(runId, "QUEUED");
    await transitionRun(runId, "RUNNING", { lockedBy: "exec-b" });
    await transitionRun(runId, "SUCCEEDED", { durationMs: 1234 });
    run = await loadRun(runId);
    expect(run.status).toBe("SUCCEEDED");
    expect(run.finishedAt).not.toBeNull();
    expect(run.durationMs).toBe(1234);

    for (const to of ["QUEUED", "RUNNING", "FAILED", "CANCELLED"] as const) await expectInvalid(transitionRun(runId, to));
  });

  it("honours expectLockedBy so a stranger cannot move a run it does not hold", async () => {
    const runId = await enqueue(t, hired);
    await transitionRun(runId, "RUNNING", { lockedBy: "owner" });
    await expectInvalid(transitionRun(runId, "SUCCEEDED", {}, { expectLockedBy: "intruder" }));
    expect((await loadRun(runId)).status).toBe("RUNNING");
    await transitionRun(runId, "FAILED", { error: "boom" }, { expectLockedBy: "owner" });
    expect((await loadRun(runId)).status).toBe("FAILED");
  });

  it("closes open work when a WAITING run fails: approvals expire, their tool calls are denied, open steps are skipped", async () => {
    const runId = await enqueue(t, hired);
    await transitionRun(runId, "RUNNING", { lockedBy: "x" });
    const toolCall = await db.toolCall.create({
      data: { runId, workerId: hired.worker.id, toolName: "send_notification", input: {}, status: "PENDING_APPROVAL", simulated: true },
    });
    const approval = await db.approval.create({
      data: { organizationId: t.organization.id, runId, workerId: hired.worker.id, toolCallId: toolCall.id, toolName: "send_notification", title: "Send it", payload: {}, status: "PENDING" },
    });
    const step = await db.runStep.create({ data: { runId, index: 0, kind: "APPROVAL", status: "WAITING", title: "Send it", input: { approvalId: approval.id } } });
    await transitionRun(runId, "WAITING_FOR_APPROVAL");

    await transitionRun(runId, "FAILED", { error: "gave up" });

    expect((await db.approval.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("EXPIRED");
    expect((await db.toolCall.findUniqueOrThrow({ where: { id: toolCall.id } })).status).toBe("DENIED");
    expect((await db.runStep.findUniqueOrThrow({ where: { id: step.id } })).status).toBe("SKIPPED");
  });

  it("throws NOT_FOUND for an unknown run", async () => {
    await expect(transitionRun("run_does_not_exist", "RUNNING")).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "NOT_FOUND");
  });
});
