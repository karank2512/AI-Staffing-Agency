import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { tickScheduler } from "@/server/runtime";
import { createTestOrg } from "../helpers/factory";
import { createHiredWorker } from "../helpers/fixtures";
import { enqueue, MINUTES, type TestOrg } from "./helpers";

describe("runtime: tickScheduler", () => {
  let t: TestOrg;
  beforeAll(async () => {
    t = await createTestOrg("rt-scheduler");
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it("enqueues SCHEDULED runs for due ACTIVE workers only, advances nextRunAt, and never double-books a busy worker", async () => {
    const now = new Date();
    const due = await createHiredWorker(t.organization.id);
    const notYet = await createHiredWorker(t.organization.id);
    const paused = await createHiredWorker(t.organization.id);
    const busy = await createHiredWorker(t.organization.id);
    const manual = await createHiredWorker(t.organization.id);
    await db.worker.update({ where: { id: due.worker.id }, data: { nextRunAt: new Date(now.getTime() - 5 * MINUTES) } });
    await db.worker.update({ where: { id: notYet.worker.id }, data: { nextRunAt: new Date(now.getTime() + 60 * MINUTES) } });
    await db.worker.update({ where: { id: paused.worker.id }, data: { status: "PAUSED", nextRunAt: new Date(now.getTime() - 5 * MINUTES) } });
    await db.worker.update({ where: { id: busy.worker.id }, data: { nextRunAt: new Date(now.getTime() - 5 * MINUTES) } });
    await enqueue(t, busy); // already has a QUEUED run
    await db.worker.update({ where: { id: manual.worker.id }, data: { scheduleKind: "MANUAL", scheduleHour: null, scheduleDow: null, nextRunAt: null } });

    expect(await tickScheduler(now, { organizationId: t.organization.id })).toBe(1);

    const runs = await db.run.findMany({ where: { workerId: due.worker.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ trigger: "SCHEDULED", status: "QUEUED", workerVersionId: due.version.id });
    expect(await db.run.count({ where: { workerId: { in: [notYet.worker.id, paused.worker.id, manual.worker.id] } } })).toBe(0);
    expect(await db.run.count({ where: { workerId: busy.worker.id } })).toBe(1);

    // Weekly on Monday 9am (fixture): the next slot is strictly in the future and on the right weekday/hour.
    const advanced = await db.worker.findUniqueOrThrow({ where: { id: due.worker.id } });
    expect(advanced.nextRunAt!.getTime()).toBeGreaterThan(now.getTime());
    expect(advanced.nextRunAt!.getDay()).toBe(1);
    expect(advanced.nextRunAt!.getHours()).toBe(9);
    expect((await db.worker.findUniqueOrThrow({ where: { id: busy.worker.id } })).nextRunAt!.getTime()).toBeLessThan(now.getTime());

    // Same tick again: nothing is due any more.
    expect(await tickScheduler(now, { organizationId: t.organization.id })).toBe(0);
    expect(await db.run.count({ where: { workerId: due.worker.id } })).toBe(1);
  });

  it("is org-scoped when asked to be", async () => {
    const other = await createTestOrg("rt-scheduler-other");
    try {
      const theirs = await createHiredWorker(other.organization.id);
      await db.worker.update({ where: { id: theirs.worker.id }, data: { nextRunAt: new Date(Date.now() - MINUTES) } });
      expect(await tickScheduler(new Date(), { organizationId: t.organization.id })).toBe(0);
      expect(await db.run.count({ where: { workerId: theirs.worker.id } })).toBe(0);
      expect(await tickScheduler(new Date(), { organizationId: other.organization.id })).toBe(1);
      expect(await db.run.count({ where: { workerId: theirs.worker.id, trigger: "SCHEDULED" } })).toBe(1);
    } finally {
      await other.cleanup();
    }
  });
});
