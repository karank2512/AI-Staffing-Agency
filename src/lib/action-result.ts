import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { isAppError } from "@/server/errors";
import { CLIENT_SAFE_ERROR_CODES, GENERIC_PUBLIC_ERROR, publicErrorMessage } from "@/server/security";

/**
 * The only shape a server action returns to the client. Actions never throw across the network boundary:
 * expected failures come back as `{ ok: false, error }` and the client toasts `error`.
 *
 * Actions that navigate on success return `{ ok: true, data: { redirectTo } }` and the client calls
 * `router.push(redirectTo)` — do not call `redirect()` inside `runAction`.
 */
export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

export const GENERIC_ACTION_ERROR = GENERIC_PUBLIC_ERROR;

/**
 * Wrap the body of a server action.
 *
 * ```ts
 * export async function pauseWorkerAction(workerId: string): Promise<ActionResult> {
 *   return runAction(async () => {
 *     const session = await requireSession();
 *     await pauseWorker(session, workerId);
 *     revalidatePath(`/workers/${workerId}`);
 *   });
 * }
 * ```
 */
export async function runAction<T = void>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (e) {
    // MUST be first: redirect() / notFound() (e.g. from requireSession) are thrown control-flow signals that
    // Next.js needs to see — swallowing them would turn a sign-in redirect into an error toast.
    unstable_rethrow(e);
    // An AppError whose code is client-safe carries a message written FOR the user (see
    // CLIENT_SAFE_ERROR_CODES). Everything else — INTERNAL, MODEL_ERROR, TOOL_ERROR, a raw exception —
    // could leak provider text, SQL or stack detail, so the user gets one generic sentence plus a
    // reference, and the real cause is logged under that reference (F-009 / INF-13).
    if (isAppError(e) && CLIENT_SAFE_ERROR_CODES.has(e.code)) return { ok: false, error: e.message };
    if (e instanceof ZodError) return { ok: false, error: zodMessage(e) };
    return { ok: false, error: publicErrorMessage(e).message };
  }
}

/** First issue only — action inputs are small, and one clear sentence beats a list in a toast. */
function zodMessage(e: ZodError): string {
  const issue = e.issues[0];
  if (!issue) return "Invalid input";
  const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return `${path}${issue.message}`;
}
