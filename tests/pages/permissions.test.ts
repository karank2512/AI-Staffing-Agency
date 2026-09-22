import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { db } from "@/server/db";
import { getApprovalsPage } from "@/server/queries/approvals";
import { getDeliverableDetail } from "@/server/queries/deliverables";
import { getJobDetail, listJobs } from "@/server/queries/jobs";
import { permissionSubset } from "@/server/queries/permissions";
import { getRunDetail } from "@/server/queries/runs";
import { getReplacePageData, getWorkerChat, getWorkerPermissions, getWorkerVersions } from "@/server/queries/worker-manage";
import { getWorkerHeader } from "@/server/queries/worker-profile";
import { getWorkforce } from "@/server/queries/workforce";
import { createProposedVersion } from "@/server/workers";
import { createTestOrg } from "../helpers/factory";
import { createHiredWorker, makeBlueprint } from "../helpers/fixtures";

/**
 * Every page view model carries what the viewer's role may do, so wave C can hide or disable controls instead
 * of letting people click things the server will refuse. The server enforces the same rules regardless — these
 * flags are a courtesy, never the boundary.
 */

type TestOrg = Awaited<ReturnType<typeof createTestOrg>>;

describe("queries: permissions on the page view models", () => {
  let t: TestOrg;
  let hired: Awaited<ReturnType<typeof createHiredWorker>>;
  let runId: string;
  let deliverableId: string;
  let versionId: string;

  beforeAll(async () => {
    t = await createTestOrg("pages-permissions");
    hired = await createHiredWorker(t.organization.id, { name: "Pia" });
    const run = await db.run.create({
      data: {
        organizationId: t.organization.id,
        jobId: hired.job.id,
        workerId: hired.worker.id,
        workerVersionId: hired.version.id,
        status: "SUCCEEDED",
        trigger: "MANUAL",
        simulated: true,
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    });
    runId = run.id;
    const deliverable = await db.deliverable.create({
      data: {
        organizationId: t.organization.id,
        jobId: hired.job.id,
        workerId: hired.worker.id,
        workerVersionId: hired.version.id,
        runId: run.id,
        title: "Weekly report",
        content: "# Weekly report",
      },
    });
    deliverableId = deliverable.id;
    const proposed = await createProposedVersion({
      organizationId: t.organization.id,
      workerId: hired.worker.id,
      blueprint: makeBlueprint({ collectorTier: "reasoning" }),
      changeReason: "REPLACEMENT",
      changeSummary: "Upgrade the researcher",
      userId: t.user.id,
    });
    versionId = proposed.versionId;
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it("builds a typed subset of the role matrix, and defaults to the least privileged viewer", () => {
    expect(permissionSubset("OWNER", ["workers.run", "org.manage"])).toEqual({ "workers.run": true, "org.manage": true });
    expect(permissionSubset("ADMIN", ["workers.hire", "org.manage"])).toEqual({ "workers.hire": true, "org.manage": false });
    expect(permissionSubset("MEMBER", ["workers.run", "workers.hire"])).toEqual({ "workers.run": true, "workers.hire": false });
    expect(permissionSubset(undefined, ["workers.run", "workers.manage"])).toEqual({ "workers.run": true, "workers.manage": false });
  });

  it("tells the workforce and worker pages what each role may do", async () => {
    const id = t.organization.id;
    const asMember = await getWorkforce(id, new Date(), { role: "MEMBER" });
    expect(asMember.permissions).toEqual({ "workers.run": true, "workers.hire": false, "workers.manage": false, "approvals.decide": true });
    const asAdmin = await getWorkforce(id, new Date(), { role: "ADMIN" });
    expect(asAdmin.permissions).toMatchObject({ "workers.hire": true, "workers.manage": true });
    // Same roster either way — only the controls differ.
    expect(asAdmin.workers.map((w) => w.id)).toEqual(asMember.workers.map((w) => w.id));

    const header = await getWorkerHeader(id, hired.worker.id, { role: "MEMBER" });
    expect(header.permissions).toMatchObject({ "workers.run": true, "workers.chat": true, "workers.manage": false, "reviews.generate": true });
    expect((await getWorkerHeader(id, hired.worker.id, { role: "ADMIN" })).permissions["workers.manage"]).toBe(true);
    // No role passed: nothing management-related is offered.
    expect((await getWorkerHeader(id, hired.worker.id)).permissions["workers.manage"]).toBe(false);
  });

  it("tells the manage tabs and the replace page the same thing", async () => {
    const id = t.organization.id;
    for (const role of ["MEMBER", "ADMIN"] as const) {
      const canManage = role === "ADMIN";
      expect((await getWorkerPermissions(id, hired.worker.id, { role })).permissions["workers.manage"]).toBe(canManage);
      expect((await getWorkerChat(id, hired.worker.id, { role })).permissions["workers.chat"]).toBe(true);
      expect((await getWorkerVersions(id, hired.worker.id, { role })).permissions["workers.manage"]).toBe(canManage);
      const replace = await getReplacePageData(id, hired.worker.id, versionId, { role });
      expect(replace.permissions["workers.hire"]).toBe(canManage);
      // The proposal is still open for both; only the right to decide it differs.
      expect(replace.canDecide).toBe(true);
    }
  });

  it("tells the run, deliverable, approvals, jobs and hire pages", async () => {
    const id = t.organization.id;
    const run = await getRunDetail(id, runId, { role: "MEMBER" });
    expect(run.permissions).toEqual({ "workers.run": true, "approvals.decide": true, "approvals.decideExternal": false });
    expect((await getRunDetail(id, runId, { role: "ADMIN" })).permissions["approvals.decideExternal"]).toBe(true);

    expect((await getDeliverableDetail(id, deliverableId, { role: "MEMBER" })).permissions["deliverables.review"]).toBe(true);
    expect((await getApprovalsPage(id, { role: "MEMBER" })).permissions).toEqual({ "approvals.decide": true, "approvals.decideExternal": false });

    const jobsForMember = await listJobs(id, { role: "MEMBER" });
    expect(jobsForMember.permissions).toEqual({ "jobs.manage": false, "workers.hire": false, "workers.manage": false });
    expect((await listJobs(id, { role: "ADMIN" })).permissions["jobs.manage"]).toBe(true);
    expect((await getJobDetail(id, hired.job.id, { role: "OWNER" })).permissions).toEqual({
      "jobs.manage": true,
      "workers.hire": true,
      "workers.manage": true,
    });
  });

  it("returns the same data for every role — the flags change, the view model does not", async () => {
    const id = t.organization.id;
    const roles: UserRole[] = ["MEMBER", "ADMIN", "OWNER"];
    const headers = await Promise.all(roles.map((role) => getWorkerHeader(id, hired.worker.id, { role })));
    const withoutPermissions = headers.map((header) => ({ ...header, permissions: undefined }));
    expect(withoutPermissions[1]).toEqual(withoutPermissions[0]);
    expect(withoutPermissions[2]).toEqual(withoutPermissions[0]);
    // …and everything stays JSON-serializable.
    expect(JSON.parse(JSON.stringify(headers[0]))).toEqual(headers[0]);
  });
});
