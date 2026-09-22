import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { DEFAULT_RUN_LIMITS } from "@/server/domain";
import { AppError } from "@/server/errors";
import { currentSpendMonth } from "@/server/security";
import {
  approveJobSpec,
  buildJobSpec,
  designBlueprint,
  discardJob,
  draftFromTemplate,
  hireWorker,
  proposeWorker,
  reviseJobSpec,
  scopeJob,
  updateJobSpec,
} from "@/server/staffing";
import { createTestOrg } from "../helpers/factory";
import { createHiredWorker } from "../helpers/fixtures";
import { asRole, rejection } from "../platform/helpers";
import { FUNDING_TRACKER, specFor } from "./helpers";

/**
 * Staffing guardrails: scoping and hiring are admin work, an over-budget or suspended workspace cannot start
 * new (paid) work, the roster has a ceiling, and no description can talk the designer past the platform limits.
 */

type TestOrg = Awaited<ReturnType<typeof createTestOrg>>;

const code = (e: unknown): string | undefined => (e instanceof AppError ? e.code : undefined);

describe("staffing guardrails: roles", () => {
  let t: TestOrg;
  let jobId: string;
  let jobSpecId: string;

  beforeAll(async () => {
    t = await createTestOrg("staffing-roles");
    const scopedJob = await scopeJob(t.session, FUNDING_TRACKER);
    jobId = scopedJob.jobId;
    const built = await buildJobSpec(t.session, jobId, {});
    jobSpecId = built.jobSpecId;
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it("refuses every job mutation for a member, with a message that names the role", async () => {
    const member = asRole(t.session, "MEMBER");
    const attempts: Array<[string, Promise<unknown>]> = [
      ["scopeJob", scopeJob(member, FUNDING_TRACKER)],
      ["buildJobSpec", buildJobSpec(member, jobId, {})],
      ["updateJobSpec", updateJobSpec(member, jobSpecId, { title: "Renamed by a member" })],
      ["approveJobSpec", approveJobSpec(member, jobSpecId)],
      ["reviseJobSpec", reviseJobSpec(member, jobId)],
      ["discardJob", discardJob(member, jobId)],
      ["proposeWorker", proposeWorker(member, jobId)],
      ["hireWorker", hireWorker(member, jobId)],
    ];
    for (const [label, promise] of attempts) {
      const err = await rejection(promise);
      expect(code(err), label).toBe("FORBIDDEN");
      expect((err as AppError).message, label).toMatch(/Only workspace admins and owners/);
    }
    // Nothing was written: the spec is still the untouched draft.
    const spec = await db.jobSpec.findUniqueOrThrow({ where: { id: jobSpecId } });
    expect(spec.status).toBe("DRAFT");
    expect((spec.spec as { title: string }).title).not.toBe("Renamed by a member");
  });

  it("lets an admin run the whole flow", async () => {
    const admin = asRole(t.session, "ADMIN");
    await approveJobSpec(admin, jobSpecId);
    const proposal = await proposeWorker(admin, jobId);
    expect(proposal.blueprint.persona.name).toBeTruthy();
    const hired = await hireWorker(admin, jobId, { startFirstRun: false });
    expect(await db.worker.count({ where: { id: hired.workerId, organizationId: t.organization.id } })).toBe(1);
  });
});

describe("staffing guardrails: quotas and ceilings", () => {
  let t: TestOrg;
  beforeAll(async () => {
    t = await createTestOrg("staffing-quota");
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it("refuses LLM-backed scoping for a suspended or over-budget workspace", async () => {
    await db.organization.update({ where: { id: t.organization.id }, data: { suspendedAt: new Date() } });
    expect(code(await rejection(scopeJob(t.session, FUNDING_TRACKER)))).toBe("FORBIDDEN");

    await db.organization.update({ where: { id: t.organization.id }, data: { suspendedAt: null, monthlyBudgetUsd: "2.00" } });
    await db.orgSpendMonth.create({ data: { organizationId: t.organization.id, month: currentSpendMonth(), costUsd: "2.50" } });
    expect(code(await rejection(scopeJob(t.session, FUNDING_TRACKER)))).toBe("LIMIT_EXCEEDED");

    // Back under the cap, scoping works again.
    await db.orgSpendMonth.deleteMany({ where: { organizationId: t.organization.id } });
    await db.organization.update({ where: { id: t.organization.id }, data: { monthlyBudgetUsd: null } });
    await expect(scopeJob(t.session, FUNDING_TRACKER)).resolves.toMatchObject({ jobId: expect.any(String) });
  });

  it("stops hiring at Organization.maxActiveWorkers and counts paused workers too", async () => {
    const org = await createTestOrg("staffing-headcount");
    try {
      await db.organization.update({ where: { id: org.organization.id }, data: { maxActiveWorkers: 2 } });
      const first = await createHiredWorker(org.organization.id, { name: "Ada" });
      await createHiredWorker(org.organization.id, { name: "Ben" });
      await db.worker.update({ where: { id: first.worker.id }, data: { status: "PAUSED" } });

      const { jobId } = await scopeJob(org.session, FUNDING_TRACKER);
      const { jobSpecId } = await buildJobSpec(org.session, jobId, {});
      await approveJobSpec(org.session, jobSpecId);
      await proposeWorker(org.session, jobId);

      const err = await rejection(hireWorker(org.session, jobId, { startFirstRun: false }));
      expect(code(err)).toBe("LIMIT_EXCEEDED");
      expect((err as AppError).message).toMatch(/the limit is 2/);

      // Retiring frees a seat.
      await db.worker.update({ where: { id: first.worker.id }, data: { status: "RETIRED", retiredAt: new Date() } });
      await expect(hireWorker(org.session, jobId, { startFirstRun: false })).resolves.toMatchObject({ workerId: expect.any(String) });
    } finally {
      await org.cleanup();
    }
  });

  it("clamps a blueprint's run limits to the platform ceilings, whatever the spec asks for", () => {
    const spec = specFor("market_research", { budget: { maxCostPerRunUsd: 5_000, maxMonthlyUsd: 100_000 } });
    const blueprint = designBlueprint(spec, draftFromTemplate(spec));
    expect(blueprint.limits.maxCostPerRunUsd).toBeLessThanOrEqual(5); // config.limits.maxCostPerRunUsd
    expect(blueprint.limits.maxToolCallsPerRun).toBeLessThanOrEqual(60);
    expect(blueprint.limits.maxRunDurationSec).toBeLessThanOrEqual(1_800);
    // The KPI target and the max_cost_usd check are clamped with it, so the worker card never promises more
    // than the runtime allows.
    expect(blueprint.kpis.find((k) => k.metric === "cost_per_run_usd")?.target).toBe(blueprint.limits.maxCostPerRunUsd);
    const costCheck = blueprint.evaluation.deterministicChecks.find((c) => c.type === "max_cost_usd");
    expect(costCheck?.config).toEqual({ max: blueprint.limits.maxCostPerRunUsd });

    // A modest spec is left exactly as designed.
    const modest = specFor("market_research", { budget: { maxCostPerRunUsd: 1 } });
    const modestBlueprint = designBlueprint(modest, draftFromTemplate(modest));
    expect(modestBlueprint.limits).toMatchObject({
      maxToolCallsPerRun: DEFAULT_RUN_LIMITS.maxToolCallsPerRun,
      maxRunDurationSec: DEFAULT_RUN_LIMITS.maxRunDurationSec,
    });
    expect(modestBlueprint.limits.maxCostPerRunUsd).toBeLessThanOrEqual(DEFAULT_RUN_LIMITS.maxCostPerRunUsd);
  });
});
