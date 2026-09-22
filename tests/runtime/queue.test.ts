import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { cancelRun, cancelWorkerRuns, claimNextRun, enqueueRun, executeRun, recoverStaleRuns, retryRun } from "@/server/runtime";
import { createTestOrg } from "../helpers/factory";
import { createHiredWorker } from "../helpers/fixtures";
import { activityTypes, checkpointOf, createRunningRun, enqueue, loadRun, MINUTES, stepsOf, type Hired, type TestOrg } from "./helpers";

const orgScoped = (t: TestOrg) => ({ organizationId: t.organization.id });

describe("runtime: enqueueRun", () => {
  let t: TestOrg;
  beforeAll(async () => {
    t = await createTestOrg("rt-enqueue");
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it("creates a QUEUED simulated run, locks the version and consumes active temporary instructions", async () => {
    const hired = await createHiredWorker(t.organization.id);
    expect(hired.version.lockedAt).toBeNull();
    const active = await db.workerMessage.create({
      data: { organizationId: t.organization.id, workerId: hired.worker.id, role: "USER", content: "Focus on vector databases this week", classification: "TEMPORARY_INSTRUCTION", instructionActive: true },
    });
    const consumed = await db.workerMessage.create({
      data: { organizationId: t.organization.id, workerId: hired.worker.id, role: "USER", content: "Old instruction", classification: "TEMPORARY_INSTRUCTION", instructionActive: false, appliedToRunId: "run_old" },
    });

    const { runId } = await enqueueRun({ organizationId: t.organization.id, workerId: hired.worker.id, trigger: "MANUAL", input: { instructions: ["top 5"] }, requestedById: t.user.id });
    const run = await loadRun(runId);
    expect(run).toMatchObject({ status: "QUEUED", trigger: "MANUAL", simulated: true, attempt: 1, workerVersionId: hired.version.id, jobId: hired.job.id, requestedById: t.user.id });
    expect(run.input).toEqual({ instructions: ["top 5", "Focus on vector databases this week"], params: {} });

    expect((await db.workerVersion.findUniqueOrThrow({ where: { id: hired.version.id } })).lockedAt).not.toBeNull();
    expect(await db.workerMessage.findUniqueOrThrow({ where: { id: active.id } })).toMatchObject({ instructionActive: false, appliedToRunId: runId });
    expect((await db.workerMessage.findUniqueOrThrow({ where: { id: consumed.id } })).appliedToRunId).toBe("run_old");

    const events = await db.activityEvent.findMany({ where: { organizationId: t.organization.id, runId } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "RUN_QUEUED", workerId: hired.worker.id, actorType: "USER", actorName: t.user.name });
    expect(events[0].title).toContain(hired.worker.name);

    // A second run does not re-consume the instruction, and the lock timestamp is stable.
    const lockedAt = (await db.workerVersion.findUniqueOrThrow({ where: { id: hired.version.id } })).lockedAt;
    const second = await enqueueRun({ organizationId: t.organization.id, workerId: hired.worker.id, trigger: "SCHEDULED" });
    expect((await loadRun(second.runId)).input).toEqual({ instructions: [], params: {} });
    expect((await db.workerVersion.findUniqueOrThrow({ where: { id: hired.version.id } })).lockedAt).toEqual(lockedAt);
  });

  it("refuses workers that are not ACTIVE, have no version, or belong to another organization", async () => {
    const hired = await createHiredWorker(t.organization.id);
    await db.worker.update({ where: { id: hired.worker.id }, data: { status: "PAUSED" } });
    await expect(enqueueRun({ organizationId: t.organization.id, workerId: hired.worker.id, trigger: "MANUAL" })).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "CONFLICT");

    await db.worker.update({ where: { id: hired.worker.id }, data: { status: "ACTIVE", currentVersionId: null } });
    await expect(enqueueRun({ organizationId: t.organization.id, workerId: hired.worker.id, trigger: "MANUAL" })).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "CONFLICT");

    const other = await createTestOrg("rt-enqueue-other");
    try {
      const theirs = await createHiredWorker(other.organization.id);
      await expect(enqueueRun({ organizationId: t.organization.id, workerId: theirs.worker.id, trigger: "MANUAL" })).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "NOT_FOUND");
    } finally {
      await other.cleanup();
    }
  });
});

describe("runtime: claimNextRun", () => {
  let t: TestOrg;
  let hired: Hired;
  beforeAll(async () => {
    t = await createTestOrg("rt-claim");
    hired = await createHiredWorker(t.organization.id);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it("claims atomically: two concurrent executors get one winner, and the claim stamps the lease", async () => {
    const runId = await enqueue(t, hired);
    const [a, b] = await Promise.all([claimNextRun("exec-a", orgScoped(t)), claimNextRun("exec-b", orgScoped(t))]);
    expect([a, b].filter((x) => x === runId)).toHaveLength(1);
    expect([a, b].filter((x) => x === null)).toHaveLength(1);

    const run = await loadRun(runId);
    expect(run.status).toBe("RUNNING");
    expect(run.lockedBy).toBe(a === runId ? "exec-a" : "exec-b");
    expect(run.lockedAt).not.toBeNull();
    expect(run.heartbeatAt).not.toBeNull();
    expect(run.startedAt).not.toBeNull();
    expect(await activityTypes(t.organization.id, runId)).toEqual(["RUN_QUEUED", "RUN_STARTED"]);

    expect(await claimNextRun("exec-c", orgScoped(t))).toBeNull();
    await db.run.update({ where: { id: runId }, data: { status: "CANCELLED" } });
  });

  it("skips runs whose worker is not ACTIVE and runs that are not yet available, oldest-available first", async () => {
    const first = await enqueue(t, hired);
    const later = await enqueueRun({ organizationId: t.organization.id, workerId: hired.worker.id, trigger: "MANUAL", availableAt: new Date(Date.now() + 10 * MINUTES) });

    await db.worker.update({ where: { id: hired.worker.id }, data: { status: "PAUSED" } });
    expect(await claimNextRun("exec", orgScoped(t))).toBeNull();

    await db.worker.update({ where: { id: hired.worker.id }, data: { status: "ACTIVE" } });
    expect(await claimNextRun("exec", orgScoped(t))).toBe(first);
    expect(await claimNextRun("exec", orgScoped(t))).toBeNull();
    expect((await loadRun(later.runId)).status).toBe("QUEUED");

    await db.run.updateMany({ where: { id: { in: [first, later.runId] } }, data: { status: "CANCELLED" } });
  });
});

describe("runtime: recoverStaleRuns", () => {
  let t: TestOrg;
  let hired: Hired;
  beforeAll(async () => {
    t = await createTestOrg("rt-recover");
    hired = await createHiredWorker(t.organization.id);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it("re-queues a run with a dead heartbeat (attempt+1) and a fresh slice never collides on step indexes", async () => {
    const run = await createRunningRun(t, hired, {
      lockedBy: "dead",
      heartbeatAt: new Date(Date.now() - 30 * MINUTES),
      // The checkpoint hint lags behind the steps actually written: the slice must trust max(DB) + 1.
      checkpoint: { version: 1, componentIndex: 0, context: {}, nextStepIndex: 1, counters: { modelCalls: 1, toolCalls: 0, costUsd: 0, activeMs: 1500 } },
    });
    await db.runStep.createMany({
      data: [
        { runId: run.id, index: 0, attempt: 1, componentId: "collector", kind: "MODEL_CALL", status: "SUCCEEDED", title: "Alex is thinking (Researcher, turn 1)" },
        { runId: run.id, index: 1, attempt: 1, componentId: "collector", kind: "TOOL_CALL", status: "RUNNING", title: "Searching the web" },
        { runId: run.id, index: 4, attempt: 1, componentId: "collector", kind: "MODEL_CALL", status: "RUNNING", title: "Alex is thinking (Researcher, turn 2)" },
      ],
    });
    const orphan = await db.toolCall.create({
      data: { runId: run.id, workerId: hired.worker.id, toolName: "web_search", attempt: 1, input: { query: "x" }, status: "RUNNING", simulated: true },
    });

    // A live run of the same org is left alone.
    const live = await createRunningRun(t, hired, { lockedBy: "alive", heartbeatAt: new Date() });

    expect(await recoverStaleRuns(orgScoped(t))).toBe(1);
    const recovered = await loadRun(run.id);
    expect(recovered).toMatchObject({ status: "QUEUED", attempt: 2, lockedBy: null, heartbeatAt: null });
    expect(recovered.error).toMatch(/stopped responding/);
    expect((await loadRun(live.id)).status).toBe("RUNNING");
    expect(await recoverStaleRuns(orgScoped(t))).toBe(0);

    const outcome = await executeRun(run.id);
    expect(outcome.status).toBe("SUCCEEDED");

    const steps = await stepsOf(run.id);
    const indexes = steps.map((s) => s.index);
    expect(new Set(indexes).size).toBe(indexes.length);
    const fresh = steps.filter((s) => s.attempt === 2);
    expect(fresh.length).toBeGreaterThan(3);
    expect(Math.min(...fresh.map((s) => s.index))).toBe(5);
    // Leftovers of the dead slice were closed as interrupted, never re-used.
    expect(steps.find((s) => s.index === 1)).toMatchObject({ status: "FAILED", error: "interrupted" });
    expect(steps.find((s) => s.index === 4)).toMatchObject({ status: "FAILED", error: "interrupted" });
    expect(steps.find((s) => s.index === 0)?.status).toBe("SUCCEEDED");
    expect(await db.toolCall.findUniqueOrThrow({ where: { id: orphan.id } })).toMatchObject({ status: "FAILED", error: "interrupted" });
    // Active time accumulates across slices and the step-index hint moved past everything the slice wrote
    // (the EVALUATION step lands after the terminal transition, so it is the one step the hint may not cover).
    const cp = checkpointOf(await loadRun(run.id));
    expect(cp.counters.activeMs).toBeGreaterThanOrEqual(1500);
    const lastExecutionStep = Math.max(...steps.filter((s) => s.kind !== "EVALUATION").map((s) => s.index));
    expect(cp.nextStepIndex).toBeGreaterThanOrEqual(lastExecutionStep + 1);

    await db.run.update({ where: { id: live.id }, data: { status: "CANCELLED", lockedBy: null } });
  });

  it("fails a stale run whose attempts are exhausted and records RUN_FAILED", async () => {
    const run = await createRunningRun(t, hired, { lockedBy: "dead", heartbeatAt: new Date(Date.now() - 30 * MINUTES), attempt: 2, maxAttempts: 2 });
    await db.runStep.create({ data: { runId: run.id, index: 0, attempt: 2, kind: "MODEL_CALL", status: "RUNNING", title: "thinking" } });

    expect(await recoverStaleRuns(orgScoped(t))).toBe(1);
    const failed = await loadRun(run.id);
    expect(failed.status).toBe("FAILED");
    expect(failed.finishedAt).not.toBeNull();
    expect(failed.error).toMatch(/no attempts remain/);
    expect((await stepsOf(run.id))[0].status).toBe("SKIPPED");
    expect(await activityTypes(t.organization.id, run.id)).toEqual(["RUN_FAILED"]);
  });

  it("does not touch another organization's stale runs when scoped", async () => {
    const other = await createTestOrg("rt-recover-other");
    try {
      const theirs = await createHiredWorker(other.organization.id);
      const run = await createRunningRun(other, theirs, { lockedBy: "dead", heartbeatAt: new Date(Date.now() - 30 * MINUTES) });
      expect(await recoverStaleRuns(orgScoped(t))).toBe(0);
      expect((await loadRun(run.id)).status).toBe("RUNNING");
      expect(await recoverStaleRuns(orgScoped(other))).toBe(1);
    } finally {
      await other.cleanup();
    }
  });
});

describe("runtime: retryRun + cancelWorkerRuns", () => {
  let t: TestOrg;
  let hired: Hired;
  beforeAll(async () => {
    t = await createTestOrg("rt-retry");
    hired = await createHiredWorker(t.organization.id);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it("retryRun creates a fresh RETRY run carrying the original input, only for FAILED/CANCELLED runs", async () => {
    const runId = await enqueue(t, hired, { instructions: ["top 3"] });
    await expect(retryRun(t.session, runId)).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "CONFLICT");

    await cancelRun(t.session, runId);
    const cancelled = await loadRun(runId);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.error).toContain(t.user.name);

    const { runId: retryId } = await retryRun(t.session, runId);
    expect(retryId).not.toBe(runId);
    const retry = await loadRun(retryId);
    expect(retry).toMatchObject({ status: "QUEUED", trigger: "RETRY", attempt: 1, requestedById: t.user.id });
    expect(retry.input).toEqual({ instructions: ["top 3"], params: {} });

    await expect(retryRun(t.session, "run_nope")).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "NOT_FOUND");
    await db.run.update({ where: { id: retryId }, data: { status: "CANCELLED" } });
  });

  it("cancelWorkerRuns cancels only the requested statuses and records RUN_CANCELLED for each", async () => {
    const queued = await enqueue(t, hired);
    const queued2 = await enqueue(t, hired);
    const running = await createRunningRun(t, hired, { lockedBy: "alive", heartbeatAt: new Date() });

    expect(await cancelWorkerRuns(t.organization.id, hired.worker.id, [])).toBe(0);
    expect(await cancelWorkerRuns(t.organization.id, hired.worker.id, ["QUEUED"])).toBe(2);
    expect((await loadRun(queued)).status).toBe("CANCELLED");
    expect((await loadRun(queued2)).status).toBe("CANCELLED");
    expect((await loadRun(running.id)).status).toBe("RUNNING");
    expect(await activityTypes(t.organization.id, queued)).toEqual(["RUN_QUEUED", "RUN_CANCELLED"]);
    expect(await cancelWorkerRuns(t.organization.id, hired.worker.id, ["QUEUED", "WAITING_FOR_APPROVAL"])).toBe(0);

    await db.run.update({ where: { id: running.id }, data: { status: "CANCELLED", lockedBy: null } });
  });

  it("cancelRun is org-scoped", async () => {
    const other = await createTestOrg("rt-cancel-other");
    try {
      const theirs = await createHiredWorker(other.organization.id);
      const runId = await enqueue(other, theirs);
      await expect(cancelRun(t.session, runId)).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "NOT_FOUND");
      expect((await loadRun(runId)).status).toBe("QUEUED");
    } finally {
      await other.cleanup();
    }
  });
});
