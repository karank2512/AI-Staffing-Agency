import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_RUN_LIMITS } from "@/server/domain";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import {
  assertOrgActive,
  assertWithinBudget,
  clampRunLimits,
  currentSpendMonth,
  getBudgetStatus,
  recordRealSpend,
} from "@/server/security";
import { createTestOrg } from "../helpers/factory";
import { withEnv } from "../platform/helpers";

describe("budget + workspace state", () => {
  let t: Awaited<ReturnType<typeof createTestOrg>>;
  const restores: Array<() => void> = [];

  beforeAll(async () => {
    t = await createTestOrg("sec-budget");
  });
  afterEach(async () => {
    while (restores.length) restores.pop()?.();
    await db.orgSpendMonth.deleteMany({ where: { organizationId: t.organization.id } });
    await db.organization.update({
      where: { id: t.organization.id },
      data: { monthlyBudgetUsd: null, suspendedAt: null },
    });
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it("uses the UTC month, not the local one", () => {
    expect(currentSpendMonth(new Date("2026-01-31T23:30:00Z"))).toBe("2026-01");
    expect(currentSpendMonth(new Date("2026-02-01T00:30:00Z"))).toBe("2026-02");
    expect(currentSpendMonth(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12");
  });

  it("falls back to the platform default budget and reports what is left", async () => {
    restores.push(withEnv({ PLATFORM_DEFAULT_MONTHLY_BUDGET_USD: "25" }));
    const empty = await getBudgetStatus(t.organization.id);
    expect(empty).toMatchObject({ month: currentSpendMonth(), spentUsd: 0, budgetUsd: 25, remainingUsd: 25, exceeded: false });

    await recordRealSpend(t.organization.id, 4.5);
    expect(await getBudgetStatus(t.organization.id)).toMatchObject({ spentUsd: 4.5, remainingUsd: 20.5, exceeded: false });

    await db.organization.update({ where: { id: t.organization.id }, data: { monthlyBudgetUsd: 4 } });
    expect(await getBudgetStatus(t.organization.id)).toMatchObject({ budgetUsd: 4, remainingUsd: 0, exceeded: true });
  });

  it("assertWithinBudget throws LIMIT_EXCEEDED and records the event once the cap is reached", async () => {
    await db.organization.update({ where: { id: t.organization.id }, data: { monthlyBudgetUsd: 1 } });
    await expect(assertWithinBudget(t.organization.id)).resolves.toBeUndefined();

    await recordRealSpend(t.organization.id, 1.000001);
    const error = await assertWithinBudget(t.organization.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("LIMIT_EXCEEDED");
    expect((error as AppError).message).toMatch(/monthly spending limit/i);

    const events = await db.securityEvent.findMany({ where: { organizationId: t.organization.id, type: "BUDGET_EXCEEDED" } });
    expect(events).toHaveLength(1);
    await db.securityEvent.deleteMany({ where: { organizationId: t.organization.id } });
  });

  it("only counts spend in the current UTC month", async () => {
    await db.orgSpendMonth.create({ data: { organizationId: t.organization.id, month: "2020-01", costUsd: 999 } });
    expect(await getBudgetStatus(t.organization.id)).toMatchObject({ spentUsd: 0 });
  });

  it("recordRealSpend increments atomically under concurrency and ignores non-positive amounts", async () => {
    await Promise.all(Array.from({ length: 25 }, () => recordRealSpend(t.organization.id, 0.04)));
    const row = await db.orgSpendMonth.findUniqueOrThrow({
      where: { organizationId_month: { organizationId: t.organization.id, month: currentSpendMonth() } },
    });
    expect(Number(row.costUsd)).toBeCloseTo(1, 6);

    await recordRealSpend(t.organization.id, 0);
    await recordRealSpend(t.organization.id, -5);
    await recordRealSpend(t.organization.id, Number.NaN);
    const after = await db.orgSpendMonth.findUniqueOrThrow({
      where: { organizationId_month: { organizationId: t.organization.id, month: currentSpendMonth() } },
    });
    expect(Number(after.costUsd)).toBeCloseTo(1, 6);
  });

  it("keeps sub-cent precision (a single model call can cost $0.000012)", async () => {
    for (let i = 0; i < 10; i++) await recordRealSpend(t.organization.id, 0.000012);
    expect((await getBudgetStatus(t.organization.id)).spentUsd).toBeCloseTo(0.00012, 8);
  });

  it("recordRealSpend never throws when the workspace is gone", async () => {
    await expect(recordRealSpend("org_does_not_exist", 1)).resolves.toBeUndefined();
  });

  it("assertOrgActive is the kill switch", async () => {
    await expect(assertOrgActive(t.organization.id)).resolves.toBeUndefined();
    await db.organization.update({ where: { id: t.organization.id }, data: { suspendedAt: new Date() } });

    const error = await assertOrgActive(t.organization.id).catch((e: unknown) => e);
    expect((error as AppError).code).toBe("FORBIDDEN");
    expect((error as AppError).message).toMatch(/suspended/i);

    const missing = await assertOrgActive("org_does_not_exist").catch((e: unknown) => e);
    expect((missing as AppError).code).toBe("NOT_FOUND");
  });
});

describe("clampRunLimits", () => {
  it("clamps a blueprint's limits down to the platform ceilings, never up", () => {
    const restore = withEnv({
      PLATFORM_MAX_COST_PER_RUN_USD: "5",
      PLATFORM_MAX_TOOL_CALLS_PER_RUN: "60",
      PLATFORM_MAX_RUN_DURATION_SEC: "1800",
    });
    try {
      expect(clampRunLimits({ maxCostPerRunUsd: 100, maxToolCallsPerRun: 500, maxRunDurationSec: 86_400 })).toEqual({
        maxCostPerRunUsd: 5,
        maxToolCallsPerRun: 60,
        maxRunDurationSec: 1800,
      });
      expect(clampRunLimits(DEFAULT_RUN_LIMITS)).toEqual(DEFAULT_RUN_LIMITS);
    } finally {
      restore();
    }
  });
});
