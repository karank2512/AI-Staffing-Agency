import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import {
  MAX_PASSWORD_BYTES,
  bcryptRounds,
  burnPasswordCompare,
  hashPassword,
  needsRehash,
  passwordByteLength,
  timingEqualizerHash,
  verifyPassword,
} from "@/server/auth/password";
import { config } from "@/server/config";

describe("password hashing", () => {
  it("round-trips: a hash verifies against the password it was made from", async () => {
    const hash = await hashPassword("demo1234");
    expect(hash).not.toContain("demo1234");
    expect(await verifyPassword("demo1234", hash)).toBe(true);
  });

  it("rejects a wrong password, including near misses", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery stapl", hash)).toBe(false);
    expect(await verifyPassword("Correct horse battery staple", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("salts every hash and uses the configured cost", async () => {
    const [a, b] = await Promise.all([hashPassword("same-password"), hashPassword("same-password")]);
    expect(a).not.toEqual(b);
    expect(bcrypt.getRounds(a)).toBe(config.auth.bcryptRounds);
    expect(bcryptRounds()).toBe(config.auth.bcryptRounds);
    expect(await verifyPassword("same-password", a)).toBe(true);
  });

  it("never throws on a malformed hash — it just fails verification", async () => {
    await expect(verifyPassword("anything", "not-a-real-hash")).resolves.toBe(false);
    await expect(verifyPassword("anything", "")).resolves.toBe(false);
  });
});

describe("needsRehash", () => {
  it("flags hashes made at a weaker cost than we use today", async () => {
    const legacy = await bcrypt.hash("whatever", 10);
    expect(bcrypt.getRounds(legacy)).toBeLessThan(config.auth.bcryptRounds);
    expect(needsRehash(legacy)).toBe(true);
  });

  it("leaves current hashes alone", async () => {
    expect(needsRehash(await hashPassword("whatever"))).toBe(false);
  });

  it("leaves an unparseable hash alone rather than rewriting it", () => {
    // Rewriting a hash we cannot read would lock the account out of its own password.
    expect(needsRehash("not-a-real-hash")).toBe(false);
    expect(needsRehash("")).toBe(false);
  });
});

describe("timing equalizer", () => {
  it("is a real bcrypt hash at the CURRENT cost, so unknown accounts cost the same as wrong passwords", async () => {
    const hash = await timingEqualizerHash();
    expect(bcrypt.getRounds(hash)).toBe(config.auth.bcryptRounds);
  });

  it("is computed once and reused", async () => {
    expect(await timingEqualizerHash()).toBe(await timingEqualizerHash());
  });

  it("never matches anything, and burning a compare always answers false", async () => {
    const hash = await timingEqualizerHash();
    expect(await verifyPassword("", hash)).toBe(false);
    expect(await burnPasswordCompare("anything at all")).toBe(false);
  });
});

describe("passwordByteLength", () => {
  it("measures UTF-8 bytes, which is what bcrypt actually consumes", () => {
    expect(passwordByteLength("abcdefghijkl")).toBe(12);
    expect(passwordByteLength("é")).toBe(2);
    expect(passwordByteLength("🙂")).toBe(4);
    expect(MAX_PASSWORD_BYTES).toBe(72);
  });
});
