import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import {
  RATE_RULES,
  enforce,
  formatWait,
  hit,
  isLocked,
  lock,
  resetLimit,
  sweepRateLimits,
  type RateRule,
} from "@/server/security";

/**
 * The limiter is shared state keyed by subject, so every test uses a unique subject and never asserts on
 * global table counts. `RATE_LIMIT_DISABLED` is set for the whole suite (tests/setup/env.ts) — these tests
 * opt back in.
 */

const ENV_FLAG = process.env.RATE_LIMIT_DISABLED;

beforeAll(() => {
  delete process.env.RATE_LIMIT_DISABLED;
});

afterAll(() => {
  if (ENV_FLAG !== undefined) process.env.RATE_LIMIT_DISABLED = ENV_FLAG;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const subject = () => `subject-${randomUUID()}`;
const rule = (over: Partial<RateRule> = {}): RateRule => ({ name: `test:${randomUUID().slice(0, 8)}`, limit: 3, windowSec: 60, ...over });

describe("rate limiter: windows", () => {
  it("allows up to the limit and then blocks with a retry-after inside the window", async () => {
    const r = rule({ limit: 3, windowSec: 120 });
    const who = subject();

    expect(await hit(r, who)).toMatchObject({ allowed: true, count: 1 });
    expect(await hit(r, who)).toMatchObject({ allowed: true, count: 2 });
    expect(await hit(r, who)).toMatchObject({ allowed: true, count: 3 });

    const blocked = await hit(r, who);
    expect(blocked.allowed).toBe(false);
    expect(blocked.count).toBe(4);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(120);
  });

  it("counts each subject separately", async () => {
    const r = rule({ limit: 1 });
    expect(await hit(r, subject())).toMatchObject({ allowed: true });
    expect(await hit(r, subject())).toMatchObject({ allowed: true });
  });

  it("restarts the count when the window has expired", async () => {
    const r = rule({ limit: 2, windowSec: 60 });
    const who = subject();
    await hit(r, who);
    await hit(r, who);
    expect(await hit(r, who)).toMatchObject({ allowed: false });

    // Age the bucket past its window — the next hit restarts at 1 inside the same statement.
    await db.$executeRaw`UPDATE "RateLimitBucket" SET "windowStart" = ${new Date(Date.now() - 61_000)} WHERE "key" LIKE ${`${r.name}:%`}`;
    expect(await hit(r, who)).toMatchObject({ allowed: true, count: 1 });
  });

  it("counts concurrent hits exactly once each", async () => {
    const r = rule({ limit: 5, windowSec: 60 });
    const who = subject();
    const results = await Promise.all(Array.from({ length: 12 }, () => hit(r, who)));
    const counts = results.map((x) => x.count).sort((a, b) => a - b);
    expect(counts).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(results.filter((x) => x.allowed)).toHaveLength(5);
  });

  it("is a no-op while RATE_LIMIT_DISABLED is set", async () => {
    process.env.RATE_LIMIT_DISABLED = "true";
    try {
      const r = rule({ limit: 1 });
      const who = subject();
      expect(await hit(r, who)).toEqual({ allowed: true, count: 0, retryAfterSec: 0 });
      expect(await hit(r, who)).toEqual({ allowed: true, count: 0, retryAfterSec: 0 });
      await expect(enforce(r, who)).resolves.toBeUndefined();
      expect(await isLocked(r, who)).toEqual({ locked: false, retryAfterSec: 0 });
    } finally {
      delete process.env.RATE_LIMIT_DISABLED;
    }
  });
});

describe("rate limiter: enforce", () => {
  it("throws LIMIT_EXCEEDED with a human wait once the limit is passed", async () => {
    const r = rule({ limit: 1, windowSec: 60 });
    const who = subject();
    await enforce(r, who);
    const error = await enforce(r, who).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("LIMIT_EXCEEDED");
    expect((error as AppError).message).toMatch(/doing that too often/i);
  });

  it("records a RATE_LIMITED security event attributed to the org for org rules", async () => {
    const org = await db.organization.create({ data: { name: `rl-${randomUUID().slice(0, 8)}`, slug: `rl-${randomUUID().slice(0, 8)}` } });
    try {
      const r = { ...RATE_RULES.credentialsOrg, limit: 1 };
      await enforce(r, org.id);
      await expect(enforce(r, org.id)).rejects.toBeInstanceOf(AppError);
      const events = await db.securityEvent.findMany({ where: { organizationId: org.id, type: "RATE_LIMITED" } });
      expect(events).toHaveLength(1);
      expect(events[0].metadata).toMatchObject({ rule: RATE_RULES.credentialsOrg.name });

      // Hammering a blocked endpoint must not turn every refusal into a database write.
      await expect(enforce(r, org.id)).rejects.toBeInstanceOf(AppError);
      await expect(enforce(r, org.id)).rejects.toBeInstanceOf(AppError);
      expect(await db.securityEvent.count({ where: { organizationId: org.id, type: "RATE_LIMITED" } })).toBe(1);
    } finally {
      await db.organization.delete({ where: { id: org.id } });
    }
  });

  it("formats waits the way a toast should read them", () => {
    expect(formatWait(20)).toBe("20 s");
    expect(formatWait(240)).toBe("4 min");
    expect(formatWait(7200)).toBe("2 h");
  });
});

describe("rate limiter: lockouts", () => {
  it("locks for one window and blocks every hit until it expires", async () => {
    const r = rule({ limit: 10, windowSec: 60 });
    const who = subject();
    const { lockedUntil } = await lock(r, who);
    expect(lockedUntil.getTime()).toBeGreaterThan(Date.now() + 50_000);

    const status = await isLocked(r, who);
    expect(status.locked).toBe(true);
    expect(status.retryAfterSec).toBeGreaterThan(0);

    const blocked = await hit(r, who);
    expect(blocked.allowed).toBe(false);
  });

  it("doubles the lockout on each repeat and caps it at 24 hours", async () => {
    const r = rule({ limit: 1, windowSec: 15 * 60 });
    const who = subject();
    const first = await lock(r, who);
    const second = await lock(r, who);
    const third = await lock(r, who);

    const minutes = (d: Date) => Math.round((d.getTime() - Date.now()) / 60_000);
    expect(minutes(first.lockedUntil)).toBe(15);
    expect(minutes(second.lockedUntil)).toBe(30);
    expect(minutes(third.lockedUntil)).toBe(60);

    for (let i = 0; i < 8; i++) await lock(r, who);
    const capped = await lock(r, who);
    expect(minutes(capped.lockedUntil)).toBe(24 * 60);
  });

  it("resetLimit clears both the counter and the lockout", async () => {
    const r = rule({ limit: 1, windowSec: 60 });
    const who = subject();
    await hit(r, who);
    await lock(r, who);
    await resetLimit(r, who);
    expect(await isLocked(r, who)).toEqual({ locked: false, retryAfterSec: 0 });
    expect(await hit(r, who)).toMatchObject({ allowed: true, count: 1 });
  });
});

describe("rate limiter: failure policy", () => {
  it("fails OPEN for product rules when the database is unreachable", async () => {
    vi.spyOn(db, "$queryRaw").mockRejectedValue(new Error("connection terminated"));
    expect(await hit(RATE_RULES.llmUser, subject())).toEqual({ allowed: true, count: 0, retryAfterSec: 0 });
  });

  it("fails CLOSED for auth rules when the database is unreachable", async () => {
    vi.spyOn(db, "$queryRaw").mockRejectedValue(new Error("connection terminated"));
    const result = await hit(RATE_RULES.signInAccount, subject());
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSec).toBeGreaterThan(0);

    vi.spyOn(db.rateLimitBucket, "findUnique").mockRejectedValue(new Error("connection terminated"));
    expect((await isLocked(RATE_RULES.signInAccount, subject())).locked).toBe(true);
    expect((await isLocked(RATE_RULES.llmUser, subject())).locked).toBe(false);
  });
});

describe("sweepRateLimits", () => {
  it("deletes idle buckets but keeps ones that are still locked", async () => {
    const idle = rule();
    const locked = rule();
    const fresh = rule();
    const who = subject();
    await hit(idle, who);
    await hit(fresh, who);
    await lock(locked, who);

    const longAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await db.$executeRaw`UPDATE "RateLimitBucket" SET "updatedAt" = ${longAgo} WHERE "key" LIKE ${`${idle.name}:%`} OR "key" LIKE ${`${locked.name}:%`}`;

    await sweepRateLimits();

    const exists = async (r: RateRule) =>
      (await db.rateLimitBucket.count({ where: { key: { startsWith: `${r.name}:` } } })) > 0;
    expect(await exists(idle)).toBe(false);
    expect(await exists(locked)).toBe(true);
    expect(await exists(fresh)).toBe(true);
  });
});
