import { CredentialsSignin } from "@auth/core/errors";
import { describe, expect, it } from "vitest";
import {
  PASSWORD_MAX_BYTES,
  SIGN_IN_MESSAGES,
  passwordChecklist,
  signInErrorMessage,
} from "@/app/(auth)/schema";
import { RateLimitedSignin } from "@/server/auth";
import { config } from "@/server/config";

/**
 * The signed-out pages' shared, framework-free helpers. They are imported by client components, so they must
 * keep working without next-auth — hence the duck-typed error mapping, checked here against the real classes.
 */

describe("signInErrorMessage", () => {
  it("maps a lockout to the 'try again later' sentence", () => {
    expect(signInErrorMessage(new RateLimitedSignin())).toBe(SIGN_IN_MESSAGES.rateLimited);
  });

  it("maps an ordinary credentials failure to the deliberately vague sentence", () => {
    const error = new CredentialsSignin();
    expect(signInErrorMessage(error)).toBe(SIGN_IN_MESSAGES.invalidCredentials);
    // It says nothing about which half was wrong.
    expect(SIGN_IN_MESSAGES.invalidCredentials).not.toMatch(/email (does not|doesn't) exist|no such account/i);
  });

  it("works on a plain object, because Auth.js classes get duplicated across bundles", () => {
    expect(signInErrorMessage({ type: "CredentialsSignin", code: "rate_limited" })).toBe(
      SIGN_IN_MESSAGES.rateLimited,
    );
    expect(signInErrorMessage({ type: "CredentialsSignin" })).toBe(SIGN_IN_MESSAGES.invalidCredentials);
  });

  it("returns null for anything else, so the caller logs it and shows the generic message", () => {
    expect(signInErrorMessage(new Error("database is on fire"))).toBeNull();
    expect(signInErrorMessage({ type: "Configuration" })).toBeNull();
    expect(signInErrorMessage(null)).toBeNull();
    expect(signInErrorMessage("nope")).toBeNull();
  });
});

describe("RateLimitedSignin", () => {
  it("is a CredentialsSignin carrying the rate_limited code Auth.js forwards", () => {
    const error = new RateLimitedSignin();
    expect(error).toBeInstanceOf(CredentialsSignin);
    expect(error.type).toBe("CredentialsSignin");
    expect(error.code).toBe("rate_limited");
  });
});

describe("passwordChecklist", () => {
  const min = config.auth.passwordMinLength;
  const ids = (password: string, ctx = {}) =>
    Object.fromEntries(passwordChecklist(password, min, ctx).map((c) => [c.id, c.ok]));

  it("starts with nothing met for an empty field", () => {
    expect(ids("")).toEqual({ length: false, bytes: false, variety: false, echo: false });
  });

  it("goes all-green for a password the server would also accept", () => {
    expect(ids("quiet river lamp 84")).toEqual({ length: true, bytes: true, variety: true, echo: true });
  });

  it("counts characters, not UTF-16 units, and bytes the way bcrypt does", () => {
    // 12 emoji are 12 characters but 48 bytes: long enough, and still inside the byte budget.
    expect(ids("🙂🙃🙁🙂🙃🙁🙂🙃🙁🙂🙃🙁")).toMatchObject({ length: true, bytes: true });
    expect(ids("🙂".repeat(19)).bytes).toBe(false);
    expect(PASSWORD_MAX_BYTES).toBe(72);
  });

  it("flags a password built from the account's own details", () => {
    expect(ids("acme-robotics-9x", { organizationName: "Acme Robotics" }).echo).toBe(false);
    expect(ids("dana-lee-forever", { name: "Dana Lee" }).echo).toBe(false);
    expect(ids("brisk-lantern-42", { email: "dana@acme.test", name: "Dana Lee" }).echo).toBe(true);
  });

  it("labels the length rule with the configured minimum", () => {
    const length = passwordChecklist("", min).find((c) => c.id === "length");
    expect(length?.label).toContain(String(min));
  });
});
