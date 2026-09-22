"use server";

import { AuthError } from "next-auth";
import { unstable_rethrow } from "next/navigation";
import { SIGN_IN_PATH, safeCallbackUrl, signIn, signOut } from "@/server/auth";
import { SIGN_IN_MESSAGES, type SignInState } from "./schema";

/**
 * Auth.js error classes can be duplicated across bundles, which breaks `instanceof`; every AuthError
 * also carries a string `type`, so fall back to that.
 */
function authErrorType(e: unknown): string | null {
  if (e instanceof AuthError) return e.type;
  if (e instanceof Error && "type" in e && typeof e.type === "string") return e.type;
  return null;
}

/** `useActionState` action for the sign-in form. On success `signIn` redirects (throws) — it never returns. */
export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = formData.get("email");
  const password = formData.get("password");
  if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
    return { error: SIGN_IN_MESSAGES.missingFields };
  }

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: safeCallbackUrl(formData.get("callbackUrl")),
    });
  } catch (e) {
    // The success path is a thrown NEXT_REDIRECT: let Next.js control-flow errors through untouched.
    unstable_rethrow(e);

    const type = authErrorType(e);
    if (type === "CredentialsSignin") return { error: SIGN_IN_MESSAGES.invalidCredentials };

    // Anything else (database down, misconfigured AUTH_SECRET …) is ours to debug, not the visitor's.
    console.error("[auth] sign-in failed", e);
    return { error: SIGN_IN_MESSAGES.unexpected };
  }

  return { error: null };
}

/** Used by the AppShell user menu. Clears the session cookie, then redirects (throws) to the sign-in page. */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: SIGN_IN_PATH });
}
