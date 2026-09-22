import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db, toJson } from "@/server/db";
import { AppError } from "@/server/errors";
import { llm } from "@/server/models";
import { cancelRun, cancelWorkerRuns, decideApproval, enqueueRun, executeRun, recoverStaleRuns } from "@/server/runtime";
import { tools } from "@/server/tools";
import type { InvokeToolResult } from "@/server/tools/types";
import { createTestOrg } from "../helpers/factory";
import { createHiredWorker } from "../helpers/fixtures";
import { checkpointOf, createRunningRun, enqueue, loadRun, MINUTES, stepsOf, type Hired, type TestOrg } from "./helpers";

/**
 * Durability edge cases: retries after a side effect, concurrent approval decisions, cancels mid-batch, crashes
 * mid-batch, and retirement while a run is in flight. Each one used to leave a run stuck or repeat an action.
 */

async function pausedRun(t: TestOrg, hired: Hired) {
  const runId = await enqueue(t, hired);
  const outcome = await executeRun(runId);
  if (outcome.status !== "WAITING_FOR_APPROVAL") throw new Error(`expected a pause, got ${outcome.status}`);
  return { runId, approvalId: outcome.approvalIds[0] };
}

const hasSendResult = (messages: Array<{ role: string; toolName?: string }>) => messages.some((m) => m.role === "tool" && m.toolName === "send_notification");

describe("runtime durability", () => {
  let t: TestOrg;
  beforeAll(async () => {
    t = await createTestOrg("rt-durability");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it("a retryable failure after an approved send continues the conversation instead of asking to send again", async () => {
    const hired = await createHiredWorker(t.organization.id, { withNotifier: true });
    const { runId, approvalId } = await pausedRun(t, hired);
    await decideApproval({ organizationId: t.organization.id, approvalId, userId: t.user.id, decision: "approve" });

    // The notification goes out, then the notifier's next model turn hits a provider outage.
    const original = llm.generateText;
    const outage = vi.spyOn(llm, "generateText").mockImplementation(async (req, tracking) => {
      if (tracking.runId === runId && hasSendResult(req.messages)) {
        outage.mockRestore();
        throw new AppError("MODEL_ERROR", "Provider unavailable: 503");
      }
      return original(req, tracking);
    });
    expect(await executeRun(runId)).toMatchObject({ status: "FAILED", willRetry: true });
    const queued = await loadRun(runId);
    expect(queued.status).toBe("QUEUED");
    // The retry resumes the notifier's conversation (which already holds the send result), not a fresh one.
    const cp = checkpointOf(queued);
    expect(cp.agent?.componentId).toBe("notifier");
    expect(hasSendResult(cp.agent?.messages ?? [])).toBe(true);

    expect(await executeRun(runId)).toMatchObject({ status: "SUCCEEDED" });
    const sends = await db.toolCall.findMany({ where: { runId, toolName: "send_notification" } });
    expect(sends.map((s) => s.status)).toEqual(["SUCCEEDED"]);
    expect(await db.approval.findMany({ where: { runId }, select: { status: true } })).toEqual([{ status: "APPROVED" }]);
    expect(await db.activityEvent.count({ where: { runId, type: "TOOL_USED" } })).toBe(1);
  });

  it("an approval-gated call's step shows the send's own duration, not the human wait; its request reads as plain text", async () => {
    const hired = await createHiredWorker(t.organization.id, { withNotifier: true });
    const { runId, approvalId } = await pausedRun(t, hired);
    const approval = await db.approval.findUniqueOrThrow({ where: { id: approvalId } });
    expect(approval.description).toBeTruthy();
    expect(approval.description).not.toMatch(/(^|\s)#{1,6}\s|\*\*|\|/);
    expect((approval.payload as { body: string }).body).toMatch(/^# /); // the payload keeps the raw markdown

    // The reviewer takes 24 minutes to decide.
    const call = await db.toolCall.findUniqueOrThrow({ where: { id: approval.toolCallId } });
    await db.runStep.update({ where: { id: call.runStepId! }, data: { startedAt: new Date(Date.now() - 24 * MINUTES) } });
    await decideApproval({ organizationId: t.organization.id, approvalId, userId: t.user.id, decision: "approve" });
    expect(await executeRun(runId)).toMatchObject({ status: "SUCCEEDED" });

    const sent = await db.toolCall.findUniqueOrThrow({ where: { id: call.id } });
    const step = await db.runStep.findUniqueOrThrow({ where: { id: call.runStepId! } });
    expect(step.status).toBe("SUCCEEDED");
    expect(step.durationMs).toBe(sent.latencyMs);
    expect(step.durationMs).toBeLessThan(60_000);
  });

  it("serializes concurrent decisions on one run: the last decision always re-queues it", async () => {
    const hired = await createHiredWorker(t.organization.id, { withNotifier: true });
    const { runId, approvalId } = await pausedRun(t, hired);
    // A second gated call on the same run (e.g. email + Slack in one batch).
    const run = await loadRun(runId);
    const call = await db.toolCall.create({
      data: { runId, workerId: hired.worker.id, toolName: "send_notification", attempt: run.attempt, input: toJson({ channel: "slack", recipients: ["#ops"], subject: "x", body: "y" }), status: "PENDING_APPROVAL", simulated: true },
    });
    const second = await db.approval.create({
      data: { organizationId: t.organization.id, runId, workerId: hired.worker.id, toolCallId: call.id, toolName: "send_notification", title: "Send to #ops", payload: toJson({}), status: "PENDING" },
    });

    // Reviewer B holds the run's lock mid-decision (approval 2 approved, approval 1 still pending in its view)…
    let release!: () => void;
    let locked!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const holding = new Promise<void>((r) => (locked = r));
    const reviewerB = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Run" WHERE "id" = ${runId} FOR UPDATE`;
        await tx.approval.update({ where: { id: second.id }, data: { status: "APPROVED", decidedAt: new Date() } });
        await tx.toolCall.update({ where: { id: call.id }, data: { status: "APPROVED" } });
        expect(await tx.approval.count({ where: { runId, status: "PENDING" } })).toBe(1);
        locked();
        await gate;
      },
      { timeout: 15_000 },
    );
    await holding;
    // …while reviewer A decides approval 1. It must wait for B instead of counting B's approval as pending.
    let aDone = false;
    const reviewerA = decideApproval({ organizationId: t.organization.id, approvalId, userId: t.user.id, decision: "approve" }).then(() => {
      aDone = true;
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(aDone).toBe(false);
    release();
    await reviewerB;
    await reviewerA;

    expect(await db.approval.count({ where: { runId, status: "PENDING" } })).toBe(0);
    expect((await loadRun(runId)).status).toBe("QUEUED");
  });

  it("re-queues a run that is waiting with no pending approval left (backstop for runs stuck before the fix)", async () => {
    const hired = await createHiredWorker(t.organization.id, { withNotifier: true });
    const { runId, approvalId } = await pausedRun(t, hired);
    await db.approval.update({ where: { id: approvalId }, data: { status: "APPROVED", decidedAt: new Date() } });
    expect(await recoverStaleRuns({ organizationId: t.organization.id })).toBe(1);
    expect((await loadRun(runId)).status).toBe("QUEUED");
    expect(await recoverStaleRuns({ organizationId: t.organization.id })).toBe(0);
  });

  it("a cancel mid-batch stops before the next tool runs and leaves no tool call in flight", async () => {
    const hired = await createHiredWorker(t.organization.id);
    const runId = await enqueue(t, hired);
    const original = tools.invoke;
    let invoked = 0;
    vi.spyOn(tools, "invoke").mockImplementation(async (args) => {
      invoked += 1;
      if (invoked === 1) await cancelRun(t.session, runId);
      return original(args);
    });

    expect(await executeRun(runId)).toEqual({ status: "CANCELLED" });
    expect(invoked).toBe(1);
    const calls = await db.toolCall.findMany({ where: { runId }, orderBy: { createdAt: "asc" } });
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.some((c) => c.status === "RUNNING" || c.status === "PENDING_APPROVAL" || c.status === "APPROVED")).toBe(false);
    // The one call already executing when the cancel landed finishes, but its result is not recorded over the
    // run's tidy-up; the rest never start.
    expect(calls.every((c) => c.status === "FAILED" && c.error === "The run ended before this call finished" && c.finishedAt !== null)).toBe(true);
    const steps = await stepsOf(runId);
    expect(steps.some((s) => ["RUNNING", "PENDING", "WAITING"].includes(s.status))).toBe(false);
  });

  it("gives one-off instructions back when their queued run is cancelled before it starts", async () => {
    const hired = await createHiredWorker(t.organization.id);
    const message = await db.workerMessage.create({
      data: { organizationId: t.organization.id, workerId: hired.worker.id, role: "USER", content: "Focus on Europe this time", classification: "TEMPORARY_INSTRUCTION", instructionActive: true },
    });
    const first = await enqueueRun({ organizationId: t.organization.id, workerId: hired.worker.id, trigger: "MANUAL" });
    expect((await loadRun(first.runId)).input).toMatchObject({ instructions: ["Focus on Europe this time"] });
    expect(await cancelWorkerRuns(t.organization.id, hired.worker.id, ["QUEUED"])).toBe(1);
    expect(await db.workerMessage.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject({ instructionActive: true, appliedToRunId: null });

    const second = await enqueueRun({ organizationId: t.organization.id, workerId: hired.worker.id, trigger: "MANUAL" });
    expect((await loadRun(second.runId)).input).toMatchObject({ instructions: ["Focus on Europe this time"] });
    expect(await db.workerMessage.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject({ instructionActive: false, appliedToRunId: second.runId });

    // A run that already started keeps them (they were applied), and a retry never duplicates them.
    await cancelRun(t.session, second.runId);
    const retried = await enqueueRun({ organizationId: t.organization.id, workerId: hired.worker.id, trigger: "RETRY", input: { instructions: ["Focus on Europe this time"] } });
    expect((await loadRun(retried.runId)).input).toMatchObject({ instructions: ["Focus on Europe this time"] });
    await cancelRun(t.session, retried.runId);
  });

  it("a crash mid-batch resumes from the batch's checkpoint: no repeated model turn, no tool run or billed twice", async () => {
    const hired = await createHiredWorker(t.organization.id);
    const runId = await enqueue(t, hired);
    const original = tools.invoke;
    let fetches = 0;
    let unblock!: (r: InvokeToolResult) => void;
    const spy = vi.spyOn(tools, "invoke").mockImplementation(async (args) => {
      if (args.ctx.runId === runId && args.toolName === "fetch_url" && ++fetches === 3) {
        // The executor "dies" while the third page is being read.
        return new Promise<InvokeToolResult>((r) => (unblock = r));
      }
      return original(args);
    });
    const dead = executeRun(runId, { executorId: "doomed" });
    await vi.waitFor(() => expect(fetches).toBe(3), { timeout: 10_000 });

    await db.run.update({ where: { id: runId }, data: { heartbeatAt: new Date(Date.now() - 30 * MINUTES) } });
    expect(await recoverStaleRuns({ organizationId: t.organization.id })).toBe(1);
    spy.mockRestore();
    const modelTurnsBefore = await db.modelCall.count({ where: { runId } });
    expect(await executeRun(runId)).toMatchObject({ status: "SUCCEEDED" });

    // The fetch batch was replayed from its rows: every fetch_url call id appears once, none attempted twice.
    const fetchCalls = await db.toolCall.findMany({ where: { runId, toolName: "fetch_url" } });
    const ids = fetchCalls.map((c) => c.callId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(fetchCalls.every((c) => c.status === "SUCCEEDED")).toBe(true);
    const billed = await db.usageRecord.count({ where: { runId, kind: "TOOL" } });
    expect(billed).toBe(await db.toolCall.count({ where: { runId, status: "SUCCEEDED" } }));
    // The resumed slice went straight to the next turn instead of re-asking for the fetch batch.
    const resumedTurns = (await db.modelCall.count({ where: { runId } })) - modelTurnsBefore;
    const collectorTurnsAfter = (await stepsOf(runId)).filter((s) => s.kind === "MODEL_CALL" && s.componentId === "collector" && s.attempt === 2);
    expect(collectorTurnsAfter.length).toBeGreaterThan(0);
    expect(resumedTurns).toBeGreaterThan(0);
    const firstResumedTurn = collectorTurnsAfter[0];
    expect(firstResumedTurn.input).toMatchObject({ turn: 3 });

    // Let the zombie slice wind down: it must notice it lost the run and write nothing more.
    unblock({ status: "error", message: "late", latencyMs: 1 });
    expect((await dead).status).toBe("SUCCEEDED");
  });

  it("a worker retired mid-run ends the run as CANCELLED instead of parking it where nothing will pick it up", async () => {
    const hired = await createHiredWorker(t.organization.id, { withNotifier: true });
    const runId = await enqueue(t, hired);
    // Retire while the collector is working.
    const original = tools.invoke;
    let retired = false;
    vi.spyOn(tools, "invoke").mockImplementation(async (args) => {
      if (!retired) {
        retired = true;
        await db.worker.update({ where: { id: hired.worker.id }, data: { status: "RETIRED", retiredAt: new Date() } });
      }
      return original(args);
    });
    expect(await executeRun(runId)).toEqual({ status: "CANCELLED" });
    const run = await loadRun(runId);
    expect(run).toMatchObject({ status: "CANCELLED", lockedBy: null, error: "Cancelled because the worker was retired" });
    expect(await db.approval.count({ where: { runId } })).toBe(0);
    expect(await db.activityEvent.count({ where: { runId, type: "RUN_CANCELLED" } })).toBe(1);
    expect((await stepsOf(runId)).some((s) => ["RUNNING", "PENDING", "WAITING"].includes(s.status))).toBe(false);
  });

  it("never asks for an approval, or re-queues a retry, for a worker retired mid-run", async () => {
    const retire = (workerId: string) => db.worker.update({ where: { id: workerId }, data: { status: "RETIRED", retiredAt: new Date() } });
    const original = llm.generateText;

    // Retired while the notifier is deciding to send: the run ends instead of pausing for approval.
    const a = await createHiredWorker(t.organization.id, { withNotifier: true });
    const runA = await enqueue(t, a);
    const spyA = vi.spyOn(llm, "generateText").mockImplementation(async (req, tracking) => {
      if (tracking.runId === runA && req.tools?.some((x) => x.name === "send_notification")) {
        spyA.mockRestore();
        await retire(a.worker.id);
      }
      return original(req, tracking);
    });
    expect(await executeRun(runA)).toEqual({ status: "CANCELLED" });
    expect(await db.approval.count({ where: { runId: runA } })).toBe(0);
    const send = await db.toolCall.findFirstOrThrow({ where: { runId: runA, toolName: "send_notification" } });
    expect(send).toMatchObject({ status: "DENIED", error: "The run ended before this call could run" });

    // Retired, then a retryable failure: the run is cancelled instead of re-queued where nothing claims it.
    const b = await createHiredWorker(t.organization.id);
    const runB = await enqueue(t, b);
    const spyB = vi.spyOn(llm, "generateText").mockImplementation(async (req, tracking) => {
      if (tracking.runId === runB) {
        spyB.mockRestore();
        await retire(b.worker.id);
        throw new AppError("MODEL_ERROR", "Provider unavailable: 503");
      }
      return original(req, tracking);
    });
    expect(await executeRun(runB)).toEqual({ status: "CANCELLED" });
    expect(await loadRun(runB)).toMatchObject({ status: "CANCELLED", attempt: 1, error: "Cancelled because the worker was retired" });
  });

  it("recovery cancels a retired worker's stale, queued or waiting runs", async () => {
    const hired = await createHiredWorker(t.organization.id, { withNotifier: true });
    const { runId: waiting } = await pausedRun(t, hired);
    const queued = await enqueue(t, hired);
    const stale = await createRunningRun(t, hired, { lockedBy: "dead", heartbeatAt: new Date(Date.now() - 30 * MINUTES) });
    await db.worker.update({ where: { id: hired.worker.id }, data: { status: "RETIRED", retiredAt: new Date() } });

    expect(await recoverStaleRuns({ organizationId: t.organization.id })).toBe(3);
    expect((await loadRun(waiting)).status).toBe("CANCELLED");
    expect((await loadRun(queued)).status).toBe("CANCELLED");
    expect(await loadRun(stale.id)).toMatchObject({ status: "CANCELLED", lockedBy: null, error: "Cancelled because the worker was retired" });
    expect(await db.approval.findMany({ where: { runId: waiting }, select: { status: true } })).toEqual([{ status: "EXPIRED" }]);
  });
});
