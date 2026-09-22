import { config } from "@/server/config";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { assertCan } from "@/server/auth/permissions";
import type { SessionContext } from "@/server/auth/types";
import { getBudgetStatus, recordSecurityEvent, requestContext } from "@/server/security";
import { UpdateOrgSettingsInputSchema, type UpdateOrgSettingsInput } from "./inputs";
import type { OrgSettingsView } from "./views";

/** Workspace-level settings: the display name and the hard cap on real provider spend. OWNER only. */

export async function getOrgSettings(organizationId: string): Promise<OrgSettingsView> {
  const [organization, memberCount, budget] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        isDemo: true,
        createdAt: true,
        monthlyBudgetUsd: true,
        maxConcurrentRuns: true,
        maxQueuedRuns: true,
        maxActiveWorkers: true,
        suspendedAt: true,
      },
    }),
    db.user.count({ where: { organizationId, disabledAt: null } }),
    getBudgetStatus(organizationId),
  ]);
  if (!organization) throw new AppError("NOT_FOUND", "Workspace not found");

  return {
    organizationId: organization.id,
    name: organization.name,
    slug: organization.slug,
    isDemo: organization.isDemo,
    createdAt: organization.createdAt.toISOString(),
    // Decimal → number at the query boundary, per the money rule.
    monthlyBudgetUsd: organization.monthlyBudgetUsd === null ? null : Number(organization.monthlyBudgetUsd),
    defaultMonthlyBudgetUsd: config.limits.defaultMonthlyBudgetUsd,
    suspended: organization.suspendedAt !== null,
    memberCount,
    limits: {
      maxConcurrentRuns: organization.maxConcurrentRuns,
      maxQueuedRuns: organization.maxQueuedRuns,
      maxActiveWorkers: organization.maxActiveWorkers,
    },
    budget,
  };
}

export async function updateOrgSettings(s: SessionContext, input: UpdateOrgSettingsInput): Promise<void> {
  assertCan(s, "org.manage");
  const parsed = UpdateOrgSettingsInputSchema.parse(input);

  const current = await db.organization.findUnique({
    where: { id: s.organizationId },
    select: { name: true, monthlyBudgetUsd: true },
  });
  if (!current) throw new AppError("NOT_FOUND", "Workspace not found");

  // Audit metadata is stored flat: the security module serializes nested values into opaque strings.
  const changed: string[] = [];
  const changes: Record<string, unknown> = {};
  if (parsed.name !== undefined && parsed.name !== current.name) {
    changed.push("name");
    changes.nameFrom = current.name;
    changes.nameTo = parsed.name;
  }
  if (parsed.monthlyBudgetUsd !== undefined) {
    const before = current.monthlyBudgetUsd === null ? null : Number(current.monthlyBudgetUsd);
    if (before !== parsed.monthlyBudgetUsd) {
      changed.push("monthlyBudgetUsd");
      changes.monthlyBudgetUsdFrom = before;
      changes.monthlyBudgetUsdTo = parsed.monthlyBudgetUsd;
    }
  }
  if (changed.length === 0) return;

  await db.organization.update({
    where: { id: s.organizationId },
    data: {
      ...(parsed.name !== undefined ? { name: parsed.name } : {}),
      ...(parsed.monthlyBudgetUsd !== undefined ? { monthlyBudgetUsd: parsed.monthlyBudgetUsd } : {}),
    },
  });

  const ctx = await requestContext();
  await recordSecurityEvent({
    type: "ORG_SETTINGS_CHANGED",
    organizationId: s.organizationId,
    userId: s.userId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    metadata: { changed: changed.join(","), ...changes },
  });
}
