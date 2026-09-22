import type { RunLimits } from "@/server/domain";
import { config } from "@/server/config";
import { db, type DbOrTx } from "@/server/db";
import { AppError, errorMessage, notFound } from "@/server/errors";
import { recordSecurityEvent } from "./audit";
import { securityLog } from "./log";

/**
 * Spend caps and workspace kill switch (F-004). "Spend" here is REAL provider spend only — Simulated runs
 * cost nothing and must never be blocked. `OrgSpendMonth` holds an O(1) month-to-date total per UTC month,
 * incremented atomically by `usage.recordUsage`, so the check is one indexed row read.
 */

export interface BudgetStatus {
  /** UTC "YYYY-MM" */
  month: string;
  spentUsd: number;
  budgetUsd: number;
  remainingUsd: number;
  exceeded: boolean;
}

/** The current UTC month key — spend windows must not move with the server's local time zone. */
export function currentSpendMonth(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

const round = (usd: number): number => Math.round(usd * 1e6) / 1e6;

export async function getBudgetStatus(organizationId: string, now: Date = new Date()): Promise<BudgetStatus> {
  const month = currentSpendMonth(now);
  const [org, spend] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { monthlyBudgetUsd: true } }),
    db.orgSpendMonth.findUnique({
      where: { organizationId_month: { organizationId, month } },
      select: { costUsd: true },
    }),
  ]);
  if (!org) throw notFound("Workspace");

  const budgetUsd = org.monthlyBudgetUsd !== null ? Number(org.monthlyBudgetUsd) : config.limits.defaultMonthlyBudgetUsd;
  const spentUsd = round(spend ? Number(spend.costUsd) : 0);
  return {
    month,
    spentUsd,
    budgetUsd,
    remainingUsd: round(Math.max(0, budgetUsd - spentUsd)),
    exceeded: budgetUsd > 0 && spentUsd >= budgetUsd,
  };
}

/** Throws LIMIT_EXCEEDED once month-to-date real spend reaches the workspace's cap. */
export async function assertWithinBudget(organizationId: string): Promise<void> {
  const status = await getBudgetStatus(organizationId);
  if (!status.exceeded) return;
  await recordSecurityEvent({
    type: "BUDGET_EXCEEDED",
    organizationId,
    metadata: { month: status.month, spentUsd: status.spentUsd, budgetUsd: status.budgetUsd },
  });
  throw new AppError(
    "LIMIT_EXCEEDED",
    `This workspace has reached its monthly spending limit of $${status.budgetUsd.toFixed(2)}. An owner can raise it in Settings.`,
  );
}

/** Operator kill switch: a suspended workspace can still be read, but nothing may be started or spent. */
export async function assertOrgActive(organizationId: string): Promise<void> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { suspendedAt: true } });
  if (!org) throw notFound("Workspace");
  if (org.suspendedAt) {
    throw new AppError("FORBIDDEN", "This workspace is suspended. Contact support to reactivate it.");
  }
}

/**
 * Atomic month-to-date increment. One statement, so concurrent runs cannot lose an increment; `updatedAt` is
 * set explicitly because raw SQL bypasses Prisma's `@updatedAt`. Never throws: spend bookkeeping must not
 * fail the call that produced the cost (the failure is logged instead).
 */
export async function recordRealSpend(organizationId: string, costUsd: number, tx?: DbOrTx): Promise<void> {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return;
  const client = tx ?? db;
  const now = new Date();
  const month = currentSpendMonth(now);
  const amount = costUsd.toFixed(6);
  try {
    await client.$executeRaw`
      INSERT INTO "OrgSpendMonth" ("organizationId", "month", "costUsd", "updatedAt")
      VALUES (${organizationId}, ${month}, ${amount}::numeric, ${now})
      ON CONFLICT ("organizationId", "month") DO UPDATE SET
        "costUsd" = "OrgSpendMonth"."costUsd" + ${amount}::numeric,
        "updatedAt" = ${now}
    `;
  } catch (e) {
    securityLog("error", "budget.spend_not_recorded", { orgId: organizationId, month, error: errorMessage(e) });
  }
}

/**
 * Platform ceilings beat a blueprint's own limits: a designed (or model-proposed) worker can ask for less
 * than the platform allows, never more.
 */
export function clampRunLimits(limits: RunLimits): RunLimits {
  return {
    maxCostPerRunUsd: Math.min(limits.maxCostPerRunUsd, config.limits.maxCostPerRunUsd),
    maxToolCallsPerRun: Math.min(limits.maxToolCallsPerRun, config.limits.maxToolCallsPerRun),
    maxRunDurationSec: Math.min(limits.maxRunDurationSec, config.limits.maxRunDurationSec),
  };
}
