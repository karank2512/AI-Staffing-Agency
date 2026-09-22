import { describe, expect, it } from "vitest";
import { getOrgSettings, updateOrgSettings } from "@/server/account";
import type { SessionContext } from "@/server/auth/types";
import { config } from "@/server/config";
import { db } from "@/server/db";
import { createTestOrg } from "../helpers/factory";
import { dropOrgs } from "./helpers";

const demote = (session: SessionContext, role: SessionContext["role"]): SessionContext => ({ ...session, role });

describe("getOrgSettings", () => {
  it("returns plain, serializable workspace settings including the budget status", async () => {
    const org = await createTestOrg("org-settings");
    try {
      const settings = await getOrgSettings(org.organization.id);
      expect(settings).toMatchObject({
        organizationId: org.organization.id,
        name: org.organization.name,
        slug: org.organization.slug,
        isDemo: false,
        suspended: false,
        memberCount: 1,
        monthlyBudgetUsd: null,
        defaultMonthlyBudgetUsd: config.limits.defaultMonthlyBudgetUsd,
      });
      expect(settings.limits).toEqual({ maxConcurrentRuns: 2, maxQueuedRuns: 20, maxActiveWorkers: 10 });
      expect(settings.budget).toMatchObject({
        month: expect.stringMatching(/^\d{4}-\d{2}$/),
        spentUsd: 0,
        exceeded: false,
      });
      // No Decimal or Date survives the boundary.
      expect(JSON.parse(JSON.stringify(settings))).toEqual(settings);
      expect(typeof settings.budget.budgetUsd).toBe("number");
    } finally {
      await org.cleanup();
    }
  });

  it("converts an explicit budget from Decimal to a number, and counts only active members", async () => {
    const org = await createTestOrg("org-budget");
    try {
      await db.organization.update({ where: { id: org.organization.id }, data: { monthlyBudgetUsd: 42.5 } });
      await db.user.create({
        data: {
          organizationId: org.organization.id,
          email: `removed-${org.organization.slug}@example.test`,
          name: "Removed",
          passwordHash: "x",
          role: "MEMBER",
          disabledAt: new Date(),
        },
      });

      const settings = await getOrgSettings(org.organization.id);
      expect(settings.monthlyBudgetUsd).toBe(42.5);
      expect(settings.budget.budgetUsd).toBe(42.5);
      expect(settings.memberCount).toBe(1);
    } finally {
      await org.cleanup();
    }
  });

  it("reports a suspended workspace", async () => {
    const org = await createTestOrg("org-suspended");
    try {
      await db.organization.update({ where: { id: org.organization.id }, data: { suspendedAt: new Date() } });
      expect((await getOrgSettings(org.organization.id)).suspended).toBe(true);
    } finally {
      await org.cleanup();
    }
  });

  it("throws NOT_FOUND for an organization that does not exist", async () => {
    await expect(getOrgSettings("org_does_not_exist")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("updateOrgSettings", () => {
  it("renames the workspace and records what changed", async () => {
    const org = await createTestOrg("org-rename");
    try {
      await updateOrgSettings(org.session, { name: "Northwind Renamed" });

      expect((await getOrgSettings(org.organization.id)).name).toBe("Northwind Renamed");
      const events = await db.securityEvent.findMany({
        where: { organizationId: org.organization.id, type: "ORG_SETTINGS_CHANGED" },
      });
      expect(events).toHaveLength(1);
      expect(events[0]?.metadata).toMatchObject({
        changed: "name",
        nameFrom: org.organization.name,
        nameTo: "Northwind Renamed",
      });
      // The slug is the stable identifier and is deliberately left alone.
      expect((await getOrgSettings(org.organization.id)).slug).toBe(org.organization.slug);
    } finally {
      await org.cleanup();
    }
  });

  it("sets and clears the monthly budget", async () => {
    const org = await createTestOrg("org-budget-set");
    try {
      await updateOrgSettings(org.session, { monthlyBudgetUsd: 125 });
      expect((await getOrgSettings(org.organization.id)).monthlyBudgetUsd).toBe(125);

      await updateOrgSettings(org.session, { monthlyBudgetUsd: null });
      const cleared = await getOrgSettings(org.organization.id);
      expect(cleared.monthlyBudgetUsd).toBeNull();
      // Falling back to the platform default is what an empty budget means.
      expect(cleared.budget.budgetUsd).toBe(config.limits.defaultMonthlyBudgetUsd);
    } finally {
      await org.cleanup();
    }
  });

  it("does nothing — and records nothing — when the values are unchanged", async () => {
    const org = await createTestOrg("org-noop");
    try {
      await updateOrgSettings(org.session, { name: org.organization.name, monthlyBudgetUsd: null });
      const events = await db.securityEvent.count({
        where: { organizationId: org.organization.id, type: "ORG_SETTINGS_CHANGED" },
      });
      expect(events).toBe(0);
    } finally {
      await org.cleanup();
    }
  });

  it("is OWNER-only", async () => {
    const org = await createTestOrg("org-permission");
    try {
      for (const role of ["ADMIN", "MEMBER"] as const) {
        await expect(updateOrgSettings(demote(org.session, role), { name: "Nope" })).rejects.toMatchObject({
          code: "FORBIDDEN",
          message: expect.stringContaining("owners"),
        });
      }
      expect((await getOrgSettings(org.organization.id)).name).toBe(org.organization.name);
    } finally {
      await org.cleanup();
    }
  });

  it("rejects malformed input and an empty change set", async () => {
    const org = await createTestOrg("org-invalid");
    try {
      await expect(updateOrgSettings(org.session, {})).rejects.toBeInstanceOf(Error);
      await expect(updateOrgSettings(org.session, { name: "x" })).rejects.toBeInstanceOf(Error);
      await expect(updateOrgSettings(org.session, { monthlyBudgetUsd: -1 })).rejects.toBeInstanceOf(Error);
    } finally {
      await org.cleanup();
    }
  });

  it("only ever touches the caller's own workspace", async () => {
    const mine = await createTestOrg("org-mine");
    const theirs = await createTestOrg("org-theirs");
    try {
      // The session carries the organization; there is no id argument to tamper with.
      await updateOrgSettings(mine.session, { name: "Mine Renamed" });
      expect((await getOrgSettings(theirs.organization.id)).name).toBe(theirs.organization.name);
    } finally {
      await dropOrgs(mine.organization.id, theirs.organization.id);
    }
  });
});
