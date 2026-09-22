import { randomBytes } from "node:crypto";
import type { AppErrorCode } from "@/server/errors";
import { errorMessage, isAppError } from "@/server/errors";
import { securityLog } from "./log";
import { redactAndClip } from "./redact";

/**
 * Client-safe error text (F-009, INF-13). Internal failures never reach a tenant: they become one generic
 * sentence plus a short reference, and the real cause is logged under that reference so support can find it.
 */

export const GENERIC_PUBLIC_ERROR = "Something went wrong. Please try again.";

/** AppError codes whose message is written FOR the user and is safe to show verbatim. */
export const CLIENT_SAFE_ERROR_CODES: ReadonlySet<AppErrorCode> = new Set<AppErrorCode>([
  "NOT_FOUND",
  "FORBIDDEN",
  "UNAUTHENTICATED",
  "VALIDATION",
  "CONFLICT",
  "IMMUTABLE_VERSION",
  "INVALID_TRANSITION",
  "PERMISSION_DENIED",
  "APPROVAL_REQUIRED",
  "LIMIT_EXCEEDED",
]);

const PUBLIC_TEXT: Partial<Record<AppErrorCode, string>> = {
  MODEL_ERROR: "The AI model is unavailable right now. Please try again shortly.",
  TOOL_ERROR: "A tool this worker relies on did not respond. Please try again shortly.",
};

const MAX_LOGGED_MESSAGE_CHARS = 500;

/** Short, non-guessable correlation id shown to the user and logged with the real error. */
export function errorRef(): string {
  return randomBytes(3).toString("hex");
}

/**
 * Turn any thrown value into a message that is safe to send to a client. Internals (message, code, provider
 * text, stack) are logged with the returned `ref` and never returned.
 */
export function publicErrorMessage(e: unknown): { message: string; ref: string } {
  const ref = errorRef();
  const code: AppErrorCode | "UNKNOWN" = isAppError(e) ? e.code : "UNKNOWN";
  const base = (isAppError(e) ? PUBLIC_TEXT[e.code] : undefined) ?? GENERIC_PUBLIC_ERROR;

  securityLog("error", "internal_error", {
    ref,
    code,
    error: redactAndClip(errorMessage(e), MAX_LOGGED_MESSAGE_CHARS),
    name: e instanceof Error ? e.name : typeof e,
  });

  return { message: `${base} (ref ${ref})`, ref };
}
