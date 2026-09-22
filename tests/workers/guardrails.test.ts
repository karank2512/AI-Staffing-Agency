import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { currentSpendMonth } from "@/server/security";
import {
  activateVersion,
  createProposedVersion,
  hireReplacement,
  pauseWorker,
  proposeReplacement,
  rejectProposedVersion,
  resumeWorker,
  retireWorker,
  sendMessageToWorker,
  startRun,
  updateSchedule,
  updateToolGrant,
} from "@/server/workers";
import { parseCostLimit } from "@/server/workers/chat-spec-change";
import { createTestOrg } from "../helpers/factory";
import { createHiredWorker, makeBlueprint } from "../helpers/fixtures";
import { asRole, rejection } from "../platform/helpers";
import type { Hired, TestOrg } from "./helpers";

/**
 * Who may manage a worker. Running and chatting are day-to-day work (MEMBER); everything that changes what the
 * worker IS — permissions, schedule, lifecycle, versions — is ADMIN, and hiring a replacement is workers.hire.
 */

const code = (e: unknown): string | undefined => (e instanceof AppError ? e.code : undefined);

describe("workers guardrails: roles", () => {
  let t: TestOrg;
  let hired: Hired;

  beforeAll(async () => {
    t = await createTestOrg("workers-roles");
    hired = await createHiredWorker(t.organization.id, { name: "Ada" });
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it("refuses every management action for a member", async () => {
    const member = asRole(t.session, "MEMBER");
    const attempts: Array<[string, Promise<unknown>]> = [
      ["pauseWorker", pauseWorker(member, hired.worker.id)],
      ["resumeWorker", resumeWorker(member, hired.worker.id)],
      ["retireWorker", retireWorker(member, hired.worker.id)],
      ["updateSchedule", updateSchedule(member, hired.worker.id, { kind: "daily", hour: 9 })],
      ["updateToolGrant", updateToolGrant(member, hired.worker.id, "web_search", { revoked: true })],
      ["proposeReplacement", proposeReplacement(member, hired.worker.id)],
    ];
    for (const [label, promise] of attempts) {
      const err = await rejection(promise);
      expect(code(err), label).toBe("FORBIDDEN");
    }
    const worker = await db.worker.findUniqueOrThrow({ where: { id: hired.worker.id } });
    expect(worker.status).toBe("ACTIVE");
    expect(worker.scheduleKind).toBe("WEEKLY");
    expect(await db.workerToolGrant.count({ where: { workerId: hired.worker.id, revokedAt: { not: null } } })).toBe(0);
  });

  it("lets a member run and chat, because that is the work", async () => {
    const member = asRole(t.session, "MEMBER");
    const { runId } = await startRun(member, hired.worker.id);
    expect(await db.run.count({ where: { id: runId, organizationId: t.organization.id } })).toBe(1);
    const reply = await sendMessageToWorker(member, hired.worker.id, "How did the last run go?");
    expect(reply.classification).toBe("QUESTION");
    await db.run.update({ where: { id: runId }, data: { status: "CANCELLED", finishedAt: new Date() } });
  });

  it("keeps version decisions for admins, including the proposal a member's chat created", async () => {
    const member = asRole(t.session, "MEMBER");
    const admin = asRole(t.session, "ADMIN");
    const { versionId } = await createProposedVersion({
      organizationId: t.organization.id,
      workerId: hired.worker.id,
      blueprint: makeBlueprint({ collectorTier: "reasoning" }),
      changeReason: "MANUAL",
      changeSummary: "Upgrade the researcher",
      userId: t.user.id,
    });

    expect(code(await rejection(rejectProposedVersion(member, versionId)))).toBe("FORBIDDEN");
    expect(code(await rejection(activateVersion(member, versionId)))).toBe("FORBIDDEN");
    expect(code(await rejection(hireReplacement(member, versionId, { startFirstRun: false })))).toBe("FORBIDDEN");
    expect((await db.workerVersion.findUniqueOrThrow({ where: { id: versionId } })).status).toBe("PROPOSED");

    await hireReplacement(admin, versionId, { startFirstRun: false });
    expect((await db.workerVersion.findUniqueOrThrow({ where: { id: versionId } })).status).toBe("ACTIVE");
  });
});

describe("workers guardrails: quotas", () => {
  let t: TestOrg;
  let hired: Hired;

  beforeAll(async () => {
    t = await createTestOrg("workers-quota");
    hired = await createHiredWorker(t.organization.id, { name: "Bo" });
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it("refuses chat and replacement planning once the workspace is over budget, and again when it is suspended", async () => {
    await db.organization.update({ where: { id: t.organization.id }, data: { monthlyBudgetUsd: "1.00" } });
    await db.orgSpendMonth.create({ data: { organizationId: t.organization.id, month: currentSpendMonth(), costUsd: "1.00" } });

    expect(code(await rejection(sendMessageToWorker(t.session, hired.worker.id, "What did you find?")))).toBe("LIMIT_EXCEEDED");
    expect(code(await rejection(proposeReplacement(t.session, hired.worker.id)))).toBe("LIMIT_EXCEEDED");
    expect(await db.workerMessage.count({ where: { workerId: hired.worker.id } })).toBe(0);

    await db.orgSpendMonth.deleteMany({ where: { organizationId: t.organization.id } });
    await db.organization.update({ where: { id: t.organization.id }, data: { monthlyBudgetUsd: null, suspendedAt: new Date() } });
    expect(code(await rejection(sendMessageToWorker(t.session, hired.worker.id, "Are you there?")))).toBe("FORBIDDEN");
    expect(code(await rejection(startRun(t.session, hired.worker.id)))).toBe("FORBIDDEN");

    await db.organization.update({ where: { id: t.organization.id }, data: { suspendedAt: null } });
    await expect(sendMessageToWorker(t.session, hired.worker.id, "Welcome back")).resolves.toMatchObject({ classification: expect.any(String) });
  });

  it("clamps a cost limit asked for in chat to the platform maximum", () => {
    expect(parseCostLimit("cap the cost at $1 per run")).toBe(1);
    expect(parseCostLimit("budget $100000 per run from now on")).toBe(5); // config.limits.maxCostPerRunUsd
    expect(parseCostLimit("send it to the team on Mondays")).toBeNull();
  });

  it("lets a replacement take over the seat it already occupies, even at the headcount ceiling", async () => {
    await db.organization.update({ where: { id: t.organization.id }, data: { maxActiveWorkers: 1 } });
    const { versionId } = await createProposedVersion({
      organizationId: t.organization.id,
      workerId: hired.worker.id,
      blueprint: makeBlueprint({ collectorTier: "reasoning" }),
      changeReason: "REPLACEMENT",
      changeSummary: "Upgrade the researcher",
      userId: t.user.id,
    });
    await expect(hireReplacement(t.session, versionId, { startFirstRun: false })).resolves.toEqual({});
    expect((await db.workerVersion.findUniqueOrThrow({ where: { id: versionId } })).status).toBe("ACTIVE");
  });
});
