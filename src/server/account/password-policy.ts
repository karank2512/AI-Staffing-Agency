import { config } from "@/server/config";
import { AppError } from "@/server/errors";
import { MAX_PASSWORD_BYTES, passwordByteLength } from "@/server/auth/password";
import { COMMON_PASSWORDS } from "./common-passwords";

/**
 * The one place that decides whether a password is acceptable. Pure (config getters only) so it can be
 * unit-tested as a table and called from sign-up, invitation acceptance and change-password alike.
 *
 * The rules are deliberately few and explainable — every rejection returns a sentence the user can act on.
 */

export type PasswordPolicyResult = { ok: true } | { ok: false; reason: string };

export interface PasswordPolicyContext {
  email?: string;
  name?: string;
  organizationName?: string;
}

/** Shortest fragment of the user's own details we will look for inside the password. */
const MIN_ECHO_LENGTH = 4;

const LEET: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "9": "g",
  "@": "a",
  $: "s",
  "!": "i",
  "|": "l",
  "+": "t",
};

const KEYBOARD_ROWS = ["`1234567890-=", "qwertyuiop[]\\", "asdfghjkl;'", "zxcvbnm,./"];

const unleet = (value: string) => [...value].map((ch) => LEET[ch] ?? ch).join("");

/**
 * Every shape of the password worth looking up in the breach list. The trailing "!2024" / "123" garnish is
 * removed BEFORE the leet substitutions, so "P@ssw0rd!2024" reduces to "password" rather than to noise.
 */
function candidateForms(password: string): string[] {
  const lower = password.toLowerCase();
  const forms = new Set<string>();
  for (const base of [lower, lower.replace(/[^a-z]+$/g, "")]) {
    for (const variant of [base, unleet(base)]) {
      forms.add(variant);
      forms.add(variant.replace(/[^a-z0-9]/g, ""));
      forms.add(variant.replace(/[^a-z]/g, ""));
    }
  }
  forms.delete("");
  return [...forms];
}

/** "aaaaaaaaaaaa", "abababababab", "123123123123" — a short unit repeated to length. */
function isRepeatedUnit(value: string): boolean {
  for (let unit = 1; unit <= 3; unit++) {
    if (value.length % unit !== 0 || value.length / unit < 3) continue;
    const head = value.slice(0, unit);
    if (value === head.repeat(value.length / unit)) return true;
  }
  return false;
}

/** "abcdefghijkl", "123456789012", "987654321098" — every step the same ±1. */
function isSequentialRun(value: string): boolean {
  if (value.length < 4) return false;
  const step = value.charCodeAt(1) - value.charCodeAt(0);
  if (step !== 1 && step !== -1) return false;
  for (let i = 2; i < value.length; i++) {
    let expected = value.charCodeAt(i - 1) + step;
    // Digit runs wrap (…890123…); letters do not.
    if (expected === 58) expected = 48;
    if (expected === 47) expected = 57;
    if (value.charCodeAt(i) !== expected) return false;
  }
  return true;
}

/** "qwertyuiop", "asdfghjkl" and their reverses — a straight walk along one keyboard row. */
function isKeyboardRun(value: string): boolean {
  if (value.length < 6) return false;
  const reversed = [...value].reverse().join("");
  return KEYBOARD_ROWS.some((row) => row.includes(value) || row.includes(reversed));
}

/** The fragments of the user's own identity a password must not simply echo back. */
function echoFragments(ctx: PasswordPolicyContext): string[] {
  const fragments: string[] = [];
  const push = (value: string | undefined) => {
    const trimmed = value?.trim().toLowerCase() ?? "";
    if (trimmed.length >= MIN_ECHO_LENGTH) fragments.push(trimmed);
  };
  const email = ctx.email?.trim().toLowerCase();
  if (email) {
    push(email);
    push(email.split("@")[0]);
    push(email.split("@")[1]?.split(".")[0]);
  }
  push(ctx.name);
  for (const part of ctx.name?.split(/\s+/) ?? []) push(part);
  push(ctx.organizationName);
  for (const part of ctx.organizationName?.split(/\s+/) ?? []) push(part);
  return fragments;
}

const fail = (reason: string): PasswordPolicyResult => ({ ok: false, reason });

/**
 * @param ctx the account's own details, so the password cannot just repeat them back.
 */
export function checkPasswordPolicy(password: string, ctx: PasswordPolicyContext = {}): PasswordPolicyResult {
  if (typeof password !== "string" || password.length === 0) return fail("Choose a password.");

  const min = config.auth.passwordMinLength;
  if ([...password].length < min) return fail(`Use at least ${min} characters.`);

  // bcrypt only mixes the first 72 bytes of a password, so anything longer would be silently truncated —
  // two different long passwords could then unlock the same account. Non-ASCII characters cost 2–4 bytes each.
  if (passwordByteLength(password) > MAX_PASSWORD_BYTES) {
    return fail(
      `Keep the password under ${MAX_PASSWORD_BYTES} bytes — that's ${MAX_PASSWORD_BYTES} characters, or fewer if you use emoji or accents (the hashing algorithm ignores anything beyond that).`,
    );
  }

  if (password.trim() !== password) return fail("Remove the leading or trailing spaces.");

  const forms = candidateForms(password);

  if (forms.some((f) => COMMON_PASSWORDS.has(f))) {
    return fail("That password appears on public breach lists. Pick something less guessable.");
  }

  if (new Set(password).size < 5) return fail("Use a wider mix of characters — this one repeats too few.");

  if (forms.some((f) => isRepeatedUnit(f) || isSequentialRun(f) || isKeyboardRun(f))) {
    return fail("Avoid repeated characters, counting sequences and keyboard runs.");
  }

  const fragments = echoFragments(ctx);
  const haystack = password.toLowerCase();
  if (fragments.some((fragment) => haystack.includes(fragment))) {
    return fail("Don't build the password out of your name, email address or workspace name.");
  }

  return { ok: true };
}

/** Throwing wrapper for the write paths (sign-up, invite acceptance, change password). */
export function assertPasswordPolicy(password: string, ctx: PasswordPolicyContext = {}): void {
  const result = checkPasswordPolicy(password, ctx);
  if (!result.ok) throw new AppError("VALIDATION", result.reason);
}
