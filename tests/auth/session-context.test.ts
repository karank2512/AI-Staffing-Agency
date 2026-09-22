import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSessionContext } from "@/server/auth/session-context";
import { db } from "@/server/db";
import { createTestOrg } from "../helpers/factory";

const identityFor = (org: Awaited<ReturnType<typeof createTestOrg>>, sessionVersion = 0) => ({
  userId: org.user.id,
  organizationId: org.organization.id,
  sessionVersion,
});

describe("loadSessionContext", () => {
  let org: Awaited<ReturnType<typeof createTestOrg>>;
  let other: Awaited<ReturnType<typeof createTestOrg>>;

  beforeAll(async () => {
    org = await createTestOrg("auth-session");
    other = await createTestOrg("auth-session-other");
  });

  afterAll(async () => {
    await org?.cleanup();
    await other?.cleanup();
  });

  it("builds the SessionContext from the database row, including the organization name", async () => {
    expect(await loadSessionContext(identityFor(org))).toEqual(org.session);
  });

  it("reflects role and name changes immediately (the token is only trusted for identity)", async () => {
    await db.user.updateMany({
      where: { id: org.user.id, organizationId: org.organization.id },
      data: { role: "MEMBER", name: "Renamed User" },
    });
    const ctx = await loadSessionContext(identityFor(org));
    expect(ctx?.role).toBe("MEMBER");
    expect(ctx?.name).toBe("Renamed User");
  });

  it("returns null when the token claims a different organization than the user's", async () => {
    expect(
      await loadSessionContext({ userId: org.user.id, organizationId: other.organization.id, sessionVersion: 0 }),
    ).toBeNull();
  });

  it("returns null for a stale token whose user no longer exists (e.g. after a re-seed)", async () => {
    const gone = await createTestOrg("auth-session-gone");
    expect(await loadSessionContext(identityFor(gone))).not.toBeNull();
    await gone.cleanup();
    expect(await loadSessionContext(identityFor(gone))).toBeNull();
  });
});

describe("loadSessionContext — revocation", () => {
  it("refuses a token whose sessionVersion is behind the user's", async () => {
    const org = await createTestOrg("auth-session-rev");
    try {
      expect(await loadSessionContext(identityFor(org, 0))).not.toBeNull();

      // What changePassword / signOutEverywhere / changeMemberRole / removeMember all do.
      await db.user.update({ where: { id: org.user.id }, data: { sessionVersion: { increment: 1 } } });

      expect(await loadSessionContext(identityFor(org, 0))).toBeNull();
      expect(await loadSessionContext(identityFor(org, 1))).not.toBeNull();
      // A token claiming a version from the future is not a session either.
      expect(await loadSessionContext(identityFor(org, 2))).toBeNull();
    } finally {
      await org.cleanup();
    }
  });

  it("refuses a disabled user (removed from the workspace)", async () => {
    const org = await createTestOrg("auth-session-disabled");
    try {
      await db.user.update({ where: { id: org.user.id }, data: { disabledAt: new Date() } });
      expect(await loadSessionContext(identityFor(org))).toBeNull();
    } finally {
      await org.cleanup();
    }
  });

  it("treats a token minted before this phase (no sessionVersion) as stale", async () => {
    const org = await createTestOrg("auth-session-legacy");
    try {
      expect(
        await loadSessionContext({
          userId: org.user.id,
          organizationId: org.organization.id,
          sessionVersion: undefined,
        }),
      ).toBeNull();
    } finally {
      await org.cleanup();
    }
  });
});
