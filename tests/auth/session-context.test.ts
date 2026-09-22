import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSessionContext } from "@/server/auth/session-context";
import { db } from "@/server/db";
import { createTestOrg } from "../helpers/factory";

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
    const ctx = await loadSessionContext({ userId: org.user.id, organizationId: org.organization.id });
    expect(ctx).toEqual(org.session);
  });

  it("reflects role and name changes immediately (the token is only trusted for identity)", async () => {
    await db.user.updateMany({
      where: { id: org.user.id, organizationId: org.organization.id },
      data: { role: "MEMBER", name: "Renamed User" },
    });
    const ctx = await loadSessionContext({ userId: org.user.id, organizationId: org.organization.id });
    expect(ctx?.role).toBe("MEMBER");
    expect(ctx?.name).toBe("Renamed User");
  });

  it("returns null when the token claims a different organization than the user's", async () => {
    expect(await loadSessionContext({ userId: org.user.id, organizationId: other.organization.id })).toBeNull();
  });

  it("returns null for a stale token whose user no longer exists (e.g. after a re-seed)", async () => {
    const gone = await createTestOrg("auth-session-gone");
    const identity = { userId: gone.user.id, organizationId: gone.organization.id };
    expect(await loadSessionContext(identity)).not.toBeNull();
    await gone.cleanup();
    expect(await loadSessionContext(identity)).toBeNull();
  });
});
