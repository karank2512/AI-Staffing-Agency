import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { TIMING_EQUALIZER_HASH } from "@/server/auth/authorize";
import { BCRYPT_ROUNDS, hashPassword, verifyPassword } from "@/server/auth/password";

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
    expect(bcrypt.getRounds(a)).toBe(BCRYPT_ROUNDS);
    expect(await verifyPassword("same-password", a)).toBe(true);
    expect(await verifyPassword("same-password", b)).toBe(true);
  });

  it("never throws on a malformed hash — it just fails verification", async () => {
    await expect(verifyPassword("anything", "not-a-real-hash")).resolves.toBe(false);
    await expect(verifyPassword("anything", "")).resolves.toBe(false);
  });

  it("keeps the timing-equalizer hash at the same cost as real hashes", () => {
    // Otherwise "unknown e-mail" and "wrong password" would take measurably different time.
    expect(bcrypt.getRounds(TIMING_EQUALIZER_HASH)).toBe(BCRYPT_ROUNDS);
  });
});
