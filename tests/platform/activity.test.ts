import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { activityHref, listActivity, recordActivity } from "@/server/activity";
import { db } from "@/server/db";
import { createTestOrg } from "../helpers/factory";
import { createHiredWorker } from "../helpers/fixtures";
import { captureConsoleError } from "./helpers";

describe("activity: activityHref (pure)", () => {
  const all = {
    workerId: "w1",
    jobId: "j1",
    runId: "r1",
    metadata: { deliverableId: "d1", approvalId: "a1", versionId: "v1" },
  };

  it("follows deliverable → approval → version → run → worker precedence", () => {
    expect(activityHref(all)).toBe("/deliverables/d1");
    expect(activityHref({ ...all, metadata: { approvalId: "a1", versionId: "v1" } })).toBe("/approvals");
    expect(activityHref({ ...all, metadata: { versionId: "v1" } })).toBe("/workers/w1/replace/v1");
    expect(activityHref({ ...all, metadata: { toolName: "web_search" } })).toBe("/runs/r1");
    expect(activityHref({ workerId: "w1", jobId: "j1", runId: null, metadata: {} })).toBe("/workers/w1");
  });

  it("needs a worker to link a version, and falls back to the job, then null", () => {
    expect(activityHref({ workerId: null, runId: "r1", metadata: { versionId: "v1" } })).toBe("/runs/r1");
    expect(activityHref({ workerId: null, jobId: "j1", runId: null, metadata: {} })).toBe("/jobs/j1");
    expect(activityHref({ workerId: null, jobId: null, runId: null, metadata: {} })).toBeNull();
    expect(activityHref({})).toBeNull();
  });

  it("ignores non-string / empty ids in metadata", () => {
    expect(activityHref({ workerId: "w1", metadata: { deliverableId: "", approvalId: 42 as unknown as string } })).toBe(
      "/workers/w1",
    );
  });
});

describe("activity: recordActivity / listActivity", () => {
  let t: Awaited<ReturnType<typeof createTestOrg>>;
  let other: Awaited<ReturnType<typeof createTestOrg>>;
  let workerId: string;
  let jobId: string;

  beforeAll(async () => {
    t = await createTestOrg("platform-activity");
    other = await createTestOrg("platform-activity-other");
    const hired = await createHiredWorker(t.organization.id, { userId: t.user.id });
    workerId = hired.worker.id;
    jobId = hired.job.id;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await db.activityEvent.deleteMany({ where: { organizationId: { in: [t.organization.id, other.organization.id] } } });
  });
  afterAll(async () => {
    await t.cleanup();
    await other.cleanup();
  });

  it("records an event with defaults and returns it as a serializable item", async () => {
    await recordActivity({
      organizationId: t.organization.id,
      type: "DELIVERABLE_CREATED",
      title: "Alex delivered 'Weekly AI Infra Funding Report'",
      detail: "12 records",
      workerId,
      jobId,
      runId: "run_123",
      actorType: "WORKER",
      actorName: "Alex",
      metadata: { deliverableId: "del_123" },
    });
    await recordActivity({ organizationId: t.organization.id, type: "NOTE", title: "System note" });

    const items = await listActivity(t.organization.id);
    expect(items).toHaveLength(2);
    expect(JSON.parse(JSON.stringify(items))).toEqual(items);

    const delivered = items.find((i) => i.type === "DELIVERABLE_CREATED");
    expect(delivered).toMatchObject({
      title: "Alex delivered 'Weekly AI Infra Funding Report'",
      detail: "12 records",
      actorType: "WORKER",
      actorName: "Alex",
      workerId,
      jobId,
      runId: "run_123",
      worker: { id: workerId, name: "Alex", avatarColor: "violet" },
      metadata: { deliverableId: "del_123" },
      href: "/deliverables/del_123",
    });
    expect(new Date(delivered?.createdAt ?? "").toISOString()).toBe(delivered?.createdAt);

    const note = items.find((i) => i.type === "NOTE");
    expect(note).toMatchObject({
      actorType: "SYSTEM",
      actorName: null,
      detail: null,
      worker: null,
      workerId: null,
      metadata: {},
      href: null,
    });
  });

  it("WITHOUT tx: swallows (and logs) a bad foreign key", async () => {
    const errors = captureConsoleError();
    await expect(
      recordActivity({
        organizationId: t.organization.id,
        type: "WORKER_PAUSED",
        title: "ghost",
        workerId: "worker_that_does_not_exist",
      }),
    ).resolves.toBeUndefined();
    await expect(
      recordActivity({ organizationId: "org_that_does_not_exist", type: "NOTE", title: "ghost" }),
    ).resolves.toBeUndefined();

    expect(errors).toHaveBeenCalledTimes(2);
    expect(await db.activityEvent.count({ where: { organizationId: t.organization.id } })).toBe(0);
  });

  it("WITH tx: lets the DB error propagate, and commits/rolls back with the transaction", async () => {
    await expect(
      db.$transaction(async (tx) => {
        await recordActivity(
          { organizationId: t.organization.id, type: "WORKER_PAUSED", title: "ghost", workerId: "worker_that_does_not_exist" },
          tx,
        );
      }),
    ).rejects.toThrow();

    await expect(
      db.$transaction(async (tx) => {
        await recordActivity({ organizationId: t.organization.id, type: "NOTE", title: "rolled back" }, tx);
        throw new Error("caller aborts");
      }),
    ).rejects.toThrow("caller aborts");

    await db.$transaction(async (tx) => {
      await recordActivity({ organizationId: t.organization.id, type: "NOTE", title: "committed" }, tx);
    });

    const titles = (await listActivity(t.organization.id)).map((i) => i.title);
    expect(titles).toEqual(["committed"]);
  });

  it("lists newest first, defaults to 50, caps at 200, and pages with `before`", async () => {
    const base = Date.now() - 1_000_000;
    await db.activityEvent.createMany({
      data: Array.from({ length: 205 }, (_, i) => ({
        organizationId: t.organization.id,
        type: "NOTE" as const,
        title: `event ${i}`,
        createdAt: new Date(base + i * 1000),
      })),
    });

    const firstPage = await listActivity(t.organization.id);
    expect(firstPage).toHaveLength(50);
    expect(firstPage[0].title).toBe("event 204");
    expect(firstPage[49].title).toBe("event 155");
    const times = firstPage.map((i) => i.createdAt);
    expect([...times].sort().reverse()).toEqual(times);

    expect(await listActivity(t.organization.id, { limit: 5 })).toHaveLength(5);
    expect(await listActivity(t.organization.id, { limit: 10_000 })).toHaveLength(200);
    expect(await listActivity(t.organization.id, { limit: 0 })).toHaveLength(1);

    const nextPage = await listActivity(t.organization.id, { before: new Date(firstPage[49].createdAt), limit: 3 });
    expect(nextPage.map((i) => i.title)).toEqual(["event 154", "event 153", "event 152"]);
  });

  it("filters by worker, job and types, and never crosses organizations", async () => {
    await recordActivity({ organizationId: t.organization.id, type: "WORKER_HIRED", title: "hired", workerId, jobId });
    await recordActivity({ organizationId: t.organization.id, type: "RUN_QUEUED", title: "queued", workerId, jobId, runId: "run_1" });
    await recordActivity({ organizationId: t.organization.id, type: "JOB_CREATED", title: "job", jobId: "job_other" });
    await recordActivity({ organizationId: other.organization.id, type: "NOTE", title: "other org" });

    const titles = async (opts: Parameters<typeof listActivity>[1]) =>
      (await listActivity(t.organization.id, opts)).map((i) => i.title).sort();

    expect(await titles({})).toEqual(["hired", "job", "queued"]);
    expect(await titles({ workerId })).toEqual(["hired", "queued"]);
    expect(await titles({ jobId: "job_other" })).toEqual(["job"]);
    expect(await titles({ types: ["RUN_QUEUED", "JOB_CREATED"] })).toEqual(["job", "queued"]);
    expect(await titles({ types: [] })).toEqual(["hired", "job", "queued"]);
    expect(await titles({ workerId, types: ["WORKER_HIRED"] })).toEqual(["hired"]);

    // Asking for this org's worker through another org's scope yields nothing.
    expect(await listActivity(other.organization.id, { workerId })).toEqual([]);
    expect((await listActivity(other.organization.id)).map((i) => i.title)).toEqual(["other org"]);

    const byTitle = new Map((await listActivity(t.organization.id)).map((i) => [i.title, i.href]));
    expect(byTitle.get("queued")).toBe("/runs/run_1");
    expect(byTitle.get("hired")).toBe(`/workers/${workerId}`);
    expect(byTitle.get("job")).toBe("/jobs/job_other");
  });

  it("computes version / approval links from metadata", async () => {
    await recordActivity({
      organizationId: t.organization.id,
      type: "VERSION_PROPOSED",
      title: "proposal",
      workerId,
      metadata: { versionId: "ver_2", version: 2, changeReason: "REPLACEMENT" },
    });
    await recordActivity({
      organizationId: t.organization.id,
      type: "APPROVAL_REQUESTED",
      title: "approval",
      workerId,
      runId: "run_9",
      metadata: { approvalId: "apr_1", toolName: "send_notification" },
    });

    const byTitle = new Map((await listActivity(t.organization.id)).map((i) => [i.title, i]));
    expect(byTitle.get("proposal")?.href).toBe(`/workers/${workerId}/replace/ver_2`);
    expect(byTitle.get("proposal")?.metadata).toEqual({ versionId: "ver_2", version: 2, changeReason: "REPLACEMENT" });
    expect(byTitle.get("approval")?.href).toBe("/approvals");
  });
});
