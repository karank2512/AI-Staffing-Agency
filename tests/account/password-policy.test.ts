import { describe, expect, it } from "vitest";
import { COMMON_PASSWORDS, assertPasswordPolicy, checkPasswordPolicy } from "@/server/account";
import { config } from "@/server/config";
import { isAppError } from "@/server/errors";

const CTX = { email: "dana@acme-robotics.test", name: "Dana Lee", organizationName: "Acme Robotics" };

describe("checkPasswordPolicy — accepts", () => {
  it.each([
    ["a passphrase", "quiet river lamp 84"],
    ["punctuation and digits", "s3cret-Passphrase!"],
    ["a short but varied phrase", "Zq7!mvx-Pilot"],
    ["a long hyphenated phrase", "correct-horse-battery"],
    ["leet-looking but unlisted", "Tr0ub4dor&3xyz"],
  ])("%s", (_label, password) => {
    expect(checkPasswordPolicy(password, CTX)).toEqual({ ok: true });
  });

  it("accepts exactly the minimum length", () => {
    const password = "wxyz-84-jkmp".slice(0, config.auth.passwordMinLength);
    expect([...password]).toHaveLength(config.auth.passwordMinLength);
    expect(checkPasswordPolicy(password).ok).toBe(true);
  });
});

describe("checkPasswordPolicy — refuses", () => {
  const reasonFor = (password: string, ctx = CTX) => {
    const result = checkPasswordPolicy(password, ctx);
    expect(result.ok).toBe(false);
    return result.ok ? "" : result.reason;
  };

  it("an empty password", () => {
    expect(reasonFor("")).toMatch(/choose a password/i);
  });

  it("anything shorter than the configured minimum", () => {
    expect(reasonFor("Summer2024!")).toMatch(new RegExp(`at least ${config.auth.passwordMinLength} characters`, "i"));
  });

  it("anything over 72 UTF-8 bytes, because bcrypt would silently ignore the rest", () => {
    // 19 emoji are only 19 characters but 76 bytes.
    const reason = reasonFor("🙂".repeat(19));
    expect(reason).toMatch(/72 bytes/);
    expect(reason).toMatch(/emoji|accents/);

    // 72 ASCII characters are fine; 73 are not.
    const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
    const long = (length: number) =>
      Array.from({ length }, (_, i) => alphabet[(i * 7) % alphabet.length]).join("");
    expect(checkPasswordPolicy(long(72)).ok).toBe(true);
    expect(checkPasswordPolicy(long(73)).ok).toBe(false);
  });

  it.each([
    ["a breach-list classic", "password1234"],
    ["the same with a capital and a bang", "Password123!"],
    ["a keyboard walk with digits", "qwertyuiop12"],
    ["leet substitutions and a year", "P@ssw0rd!2024"],
    ["a sentimental classic", "iloveyou1234"],
  ])("%s", (_label, password) => {
    expect(reasonFor(password)).toMatch(/breach lists/i);
  });

  it("a single repeated character or too few distinct ones", () => {
    expect(reasonFor("aaaaaaaaaaaa")).toMatch(/wider mix/i);
    expect(reasonFor("abababababab")).toMatch(/wider mix/i);
  });

  it("counting sequences in either direction", () => {
    expect(reasonFor("123456789012")).toMatch(/sequences/i);
    expect(reasonFor("abcdefghijkl")).toMatch(/sequences/i);
    expect(reasonFor("ponmlkjihgfe")).toMatch(/sequences/i);
  });

  it("a password built out of the account's own details", () => {
    expect(reasonFor("acme-robotics-9x")).toMatch(/name, email address or workspace/i);
    expect(reasonFor("dana-lee-forever")).toMatch(/name, email address or workspace/i);
    expect(reasonFor("xx-Dana@ACME-77x")).toMatch(/name, email address or workspace/i);
  });

  it("only treats identity fragments of four characters or more as an echo", () => {
    // A two-letter name would otherwise ban every password containing those letters.
    expect(checkPasswordPolicy("brisk-lantern-42", { name: "Jo", email: "jo@x.test" }).ok).toBe(true);
  });

  it("leading or trailing spaces, which people cannot see and browsers eat", () => {
    expect(reasonFor(" quiet river lamp 84")).toMatch(/spaces/i);
  });
});

describe("checkPasswordPolicy — context is optional", () => {
  it("works with no context at all", () => {
    expect(checkPasswordPolicy("quiet river lamp 84")).toEqual({ ok: true });
    expect(checkPasswordPolicy("password1234").ok).toBe(false);
  });
});

describe("assertPasswordPolicy", () => {
  it("throws a VALIDATION AppError carrying the same sentence", () => {
    try {
      assertPasswordPolicy("password1234");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(isAppError(e)).toBe(true);
      if (isAppError(e)) {
        expect(e.code).toBe("VALIDATION");
        expect(e.message).toMatch(/breach lists/i);
      }
    }
  });

  it("is silent for an acceptable password", () => {
    expect(() => assertPasswordPolicy("quiet river lamp 84")).not.toThrow();
  });
});

describe("COMMON_PASSWORDS", () => {
  it("bundles around a thousand lower-cased stems", () => {
    expect(COMMON_PASSWORDS.size).toBeGreaterThanOrEqual(1000);
    for (const entry of COMMON_PASSWORDS) {
      expect(entry).toBe(entry.toLowerCase());
      expect(entry).not.toMatch(/\s/);
    }
  });

  it("contains the usual suspects", () => {
    for (const entry of ["password", "qwerty", "letmein", "iloveyou", "123456"]) {
      expect(COMMON_PASSWORDS.has(entry)).toBe(true);
    }
  });
});
