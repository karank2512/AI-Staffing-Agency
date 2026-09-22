import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createProposedVersion, pauseWorker, resumeWorker, retireWorker, startRun, updateSchedule, updateToolGrant } from "@/server/workers";
import { createTestOrg } from "../helpers/factory";
import { createHiredWorker } from "../helpers/fixtures";
import { activityOf, createRun, grantsOf, loadWorkerRow, type Hired, type TestOrg } from "./helpers";

describe("worker lifecycle", () => {
  let t: TestOrg;
  let hired: Hired;

  beforeEach(async () => {
    t = await createTestOrg("workers-lifecycle");
    hired = await createHiredWorker(t.organization.id, { userId: t.user.id });
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("pause cancels queued runs, clears nextRunAt and leaves waiting runs alone", async () => {
    await db.worker.update({ where: { id: hired.worker.id }, data: { nextRunAt: new Date(Date.now() + 3_600_000) } });
    const queued = await createRun(hired, { status: "QUEUED" });
    const waiting = await createRun(hired, { status: "WAITING_FOR_APPROVAL" });

    await pauseWorker(t.session, hired.worker.id);

    const worker = await loadWorkerRow(hired.worker.id);
    expect(worker.status).toBe("PAUSED");
    expect(worker.nextRunAt).toBeNull();
    expect((await db.run.findUniqueOrThrow({ where: { id: queued.id } })).status).toBe("CANCELLED");
    expect((await db.run.findUniqueOrThrow({ where: { id: waiting.id } })).status).toBe("WAITING_FOR_APPROVAL");
    const events = await activityOf(t.organization.id, hired.worker.id, "WORKER_PAUSED");
    expect(events).toHaveLength(1);
    expect(events[0].detail).toContain("1 queued run cancelled");

    await expect(pauseWorker(t.session, hired.worker.id)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(startRun(t.session, hired.worker.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("resume re-activates and recomputes nextRunAt from the worker's schedule", async () => {
    await pauseWorker(t.session, hired.worker.id);
    const before = new Date();
    await resumeWorker(t.session, hired.worker.id);

    const worker = await loadWorkerRow(hired.worker.id);
    expect(worker.status).toBe("ACTIVE");
    expect(worker.nextRunAt).not.toBeNull();
    expect(worker.nextRunAt!.getTime()).toBeGreaterThan(before.getTime());
    expect(worker.nextRunAt!.getDay()).toBe(1);
    expect(worker.nextRunAt!.getHours()).toBe(9);
    expect(await activityOf(t.organization.id, hired.worker.id, "WORKER_RESUMED")).toHaveLength(1);
    await expect(resumeWorker(t.session, hired.worker.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("retire cancels queued and waiting runs, closes open proposals and reopens the job", async () => {
    const queued = await createRun(hired, { status: "QUEUED" });
    const waiting = await createRun(hired, { status: "WAITING_FOR_APPROVAL" });
    const proposal = await createProposedVersion({ organizationId: t.organization.id, workerId: hired.worker.id, blueprint: hired.blueprint, changeReason: "MANUAL", changeSummary: "" });

    await retireWorker(t.session, hired.worker.id);

    const worker = await loadWorkerRow(hired.worker.id);
    expect(worker.status).toBe("RETIRED");
    expect(worker.retiredAt).not.toBeNull();
    expect(worker.nextRunAt).toBeNull();
    expect((await db.run.findUniqueOrThrow({ where: { id: queued.id } })).status).toBe("CANCELLED");
    expect((await db.run.findUniqueOrThrow({ where: { id: waiting.id } })).status).toBe("CANCELLED");
    expect((await db.workerVersion.findUniqueOrThrow({ where: { id: proposal.versionId } })).status).toBe("REJECTED");
    expect((await db.job.findUniqueOrThrow({ where: { id: hired.job.id } })).status).toBe("SPEC_APPROVED");
    const events = await activityOf(t.organization.id, hired.worker.id, "WORKER_RETIRED");
    expect(events).toHaveLength(1);
    expect(events[0].detail).toContain("2 open runs cancelled");

    await expect(retireWorker(t.session, hired.worker.id)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(pauseWorker(t.session, hired.worker.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("retire keeps the job STAFFED while another active worker holds it", async () => {
    const second = await db.worker.create({
      data: { organizationId: t.organization.id, jobId: hired.job.id, name: "Maya", title: "AI Market Researcher", status: "ACTIVE" },
    });
    await retireWorker(t.session, hired.worker.id);
    expect((await db.job.findUniqueOrThrow({ where: { id: hired.job.id } })).status).toBe("STAFFED");
    expect((await loadWorkerRow(second.id)).status).toBe("ACTIVE");
  });

  it("updateSchedule writes the schedule fields and nextRunAt (null while paused)", async () => {
    await updateSchedule(t.session, hired.worker.id, { kind: "daily", hour: 7 });
    let worker = await loadWorkerRow(hired.worker.id);
    expect(worker.scheduleKind).toBe("DAILY");
    expect(worker.scheduleHour).toBe(7);
    expect(worker.scheduleDow).toBeNull();
    expect(worker.nextRunAt?.getHours()).toBe(7);

    await pauseWorker(t.session, hired.worker.id);
    await updateSchedule(t.session, hired.worker.id, { kind: "weekly", hour: 10, dayOfWeek: 3 });
    worker = await loadWorkerRow(hired.worker.id);
    expect(worker.scheduleKind).toBe("WEEKLY");
    expect(worker.scheduleDow).toBe(3);
    expect(worker.nextRunAt).toBeNull();

    await resumeWorker(t.session, hired.worker.id);
    worker = await loadWorkerRow(hired.worker.id);
    expect(worker.nextRunAt?.getDay()).toBe(3);
    expect(worker.nextRunAt?.getHours()).toBe(10);

    await updateSchedule(t.session, hired.worker.id, { kind: "manual" });
    worker = await loadWorkerRow(hired.worker.id);
    expect(worker.scheduleKind).toBe("MANUAL");
    expect(worker.nextRunAt).toBeNull();

    await expect(updateSchedule(t.session, hired.worker.id, { kind: "daily", hour: 27 } as never)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("updateToolGrant revokes, restores and toggles approval with PERMISSION_CHANGED activity", async () => {
    await updateToolGrant(t.session, hired.worker.id, "web_search", { revoked: true });
    expect((await grantsOf(hired.worker.id)).get("web_search")?.revokedAt).not.toBeNull();

    await updateToolGrant(t.session, hired.worker.id, "web_search", { revoked: false });
    expect((await grantsOf(hired.worker.id)).get("web_search")?.revokedAt).toBeNull();

    await updateToolGrant(t.session, hired.worker.id, "fetch_url", { requiresApproval: true });
    expect((await grantsOf(hired.worker.id)).get("fetch_url")?.requiresApproval).toBe(true);
    await updateToolGrant(t.session, hired.worker.id, "fetch_url", { requiresApproval: false });
    expect((await grantsOf(hired.worker.id)).get("fetch_url")?.requiresApproval).toBe(false);

    // A tool without a grant yet is upserted (registry default applies); approval-gated tools cannot be loosened.
    await updateToolGrant(t.session, hired.worker.id, "send_notification", { requiresApproval: true });
    expect((await grantsOf(hired.worker.id)).get("send_notification")?.requiresApproval).toBe(true);
    await expect(updateToolGrant(t.session, hired.worker.id, "send_notification", { requiresApproval: false })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(updateToolGrant(t.session, hired.worker.id, "not_a_tool", { revoked: true })).rejects.toMatchObject({ code: "VALIDATION" });

    const events = await activityOf(t.organization.id, hired.worker.id, "PERMISSION_CHANGED");
    expect(events.map((e) => e.title)).toEqual([
      "Access to web_search revoked",
      "Access to web_search restored",
      "Approval now required for fetch_url",
      "Approval no longer required for fetch_url",
      "Approval now required for send_notification · Access to send_notification granted",
    ]);
    expect(events[0].metadata).toMatchObject({ toolName: "web_search" });

    // No change → no event.
    await updateToolGrant(t.session, hired.worker.id, "fetch_url", { requiresApproval: false });
    expect(await activityOf(t.organization.id, hired.worker.id, "PERMISSION_CHANGED")).toHaveLength(5);
  });

  it("startRun queues a MANUAL run carrying the one-off instructions", async () => {
    const { runId } = await startRun(t.session, hired.worker.id, { instructions: ["  Focus on Series A rounds  ", ""] });
    const run = await db.run.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe("QUEUED");
    expect(run.trigger).toBe("MANUAL");
    expect(run.workerVersionId).toBe(hired.version.id);
    expect(run.requestedById).toBe(t.user.id);
    expect(run.input).toMatchObject({ instructions: ["Focus on Series A rounds"] });
    await expect(startRun(t.session, hired.worker.id, { instructions: Array.from({ length: 11 }, () => "x") })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
