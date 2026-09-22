import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { MAX_USER_AGENT_CHARS, hashEmail, listSecurityEvents, recordSecurityEvent, sweepSecurityEvents } from "@/server/security";
import { createTestOrg } from "../helpers/factory";

describe("security events", () => {
  let t: Awaited<ReturnType<typeof createTestOrg>>;
  let other: Awaited<ReturnType<typeof createTestOrg>>;

  beforeAll(async () => {
    t = await createTestOrg("sec-audit");
    other = await createTestOrg("sec-audit-other");
  });
  afterAll(async () => {
    await t.cleanup();
    await other.cleanup();
  });

  it("stores the hash of an email, never the address", async () => {
    await recordSecurityEvent({ type: "SIGN_IN_FAILED", email: "Person@Example.com", ip: "203.0.113.7" });
    const row = await db.securityEvent.findFirstOrThrow({
      where: { emailHash: hashEmail("person@example.com") },
      orderBy: { createdAt: "desc" },
    });
    expect(row.type).toBe("SIGN_IN_FAILED");
    expect(row.ip).toBe("203.0.113.7");
    expect(JSON.stringify(row)).not.toContain("person@example.com");
    await db.securityEvent.delete({ where: { id: row.id } });
  });

  it("clips the user agent and strips secrets from metadata", async () => {
    await recordSecurityEvent({
      type: "CREDENTIAL_SET",
      organizationId: t.organization.id,
      userId: t.user.id,
      userAgent: `Mozilla/5.0 ${"x".repeat(500)}`,
      metadata: { name: "TAVILY_API_KEY", value: "tvly-dev-abcdef123456", note: "rotated sk-ant-api03-Zm9vYmFyYmF6" },
    });
    const [event] = await listSecurityEvents(t.organization.id, { limit: 1 });
    expect(event.userAgent).toHaveLength(MAX_USER_AGENT_CHARS);
    expect(event.metadata).toMatchObject({ name: "TAVILY_API_KEY", value: "[redacted]" });
    expect(JSON.stringify(event.metadata)).not.toContain("Zm9vYmFy");
    expect(event.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("never throws, whatever the database says", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // A user id from another workspace violates the foreign key — the caller must not care.
    await expect(
      recordSecurityEvent({ type: "SIGN_IN_SUCCEEDED", organizationId: t.organization.id, userId: "user_does_not_exist" }),
    ).resolves.toBeUndefined();

    vi.spyOn(db.securityEvent, "create").mockRejectedValueOnce(new Error("connection terminated"));
    await expect(recordSecurityEvent({ type: "SIGN_OUT", organizationId: t.organization.id })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("lists newest first, scoped to the workspace and optionally to one user", async () => {
    await db.securityEvent.deleteMany({ where: { organizationId: { in: [t.organization.id, other.organization.id] } } });
    await recordSecurityEvent({ type: "SIGN_IN_SUCCEEDED", organizationId: t.organization.id, userId: t.user.id });
    await recordSecurityEvent({ type: "PASSWORD_CHANGED", organizationId: t.organization.id });
    await recordSecurityEvent({ type: "SIGN_IN_SUCCEEDED", organizationId: other.organization.id, userId: other.user.id });

    const mine = await listSecurityEvents(t.organization.id);
    expect(mine.map((e) => e.type).sort()).toEqual(["PASSWORD_CHANGED", "SIGN_IN_SUCCEEDED"]);
    expect(await listSecurityEvents(t.organization.id, { userId: t.user.id })).toHaveLength(1);
    expect(await listSecurityEvents(other.organization.id)).toHaveLength(1);
    expect(await listSecurityEvents(t.organization.id, { limit: 1 })).toHaveLength(1);

    // Newest first.
    await db.securityEvent.create({
      data: { type: "ROLE_CHANGED", organizationId: t.organization.id, createdAt: new Date("2026-01-01T00:00:00Z") },
    });
    expect((await listSecurityEvents(t.organization.id))[0].type).not.toBe("ROLE_CHANGED");
    await db.securityEvent.create({
      data: { type: "MEMBER_REMOVED", organizationId: t.organization.id, createdAt: new Date("2099-01-01T00:00:00Z") },
    });
    expect((await listSecurityEvents(t.organization.id))[0].type).toBe("MEMBER_REMOVED");
  });

  it("sweeps events older than the retention cutoff", async () => {
    await db.securityEvent.deleteMany({ where: { organizationId: t.organization.id } });
    await recordSecurityEvent({ type: "SIGN_IN_SUCCEEDED", organizationId: t.organization.id });
    const old = await db.securityEvent.create({
      data: { type: "SIGN_IN_FAILED", organizationId: t.organization.id, createdAt: new Date("2020-01-01T00:00:00Z") },
    });

    await sweepSecurityEvents(new Date("2021-01-01T00:00:00Z"));
    expect(await db.securityEvent.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await listSecurityEvents(t.organization.id)).toHaveLength(1);
  });
});
