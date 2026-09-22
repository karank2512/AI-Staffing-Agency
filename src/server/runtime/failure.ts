import { errorMessage, isAppError, type AppErrorCode } from "@/server/errors";

/**
 * Executor control flow.
 *
 * `LockLost` is thrown by every fenced Run write whose guard matched nothing (the run was cancelled, recovered
 * by another executor, or finished elsewhere). It is a signal, not an error: the slice stops immediately and
 * writes nothing further. `RunFailure` is what a component raises when the run genuinely failed; its
 * `retryable` flag decides between a backoff re-queue and a terminal FAILED.
 */

export class LockLost extends Error {
  constructor(message = "Run lock lost") {
    super(message);
    this.name = "LockLost";
  }
}

export class RunFailure extends Error {
  readonly code: AppErrorCode;
  readonly retryable: boolean;

  constructor(code: AppErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = "RunFailure";
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * The run can no longer go anywhere useful and must end as CANCELLED (today: its worker was retired while it was
 * in flight — claimNextRun never picks up a retired worker's run, so parking it in QUEUED/WAITING would strand it).
 */
export class RunCancelled extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "RunCancelled";
  }
}

export const WORKER_RETIRED_REASON = "Cancelled because the worker was retired";

/** Errors whose cause is the run's own definition or a hard rule: retrying would only repeat them. */
const NON_RETRYABLE: ReadonlySet<AppErrorCode> = new Set<AppErrorCode>([
  "LIMIT_EXCEEDED",
  "VALIDATION",
  "PERMISSION_DENIED",
  "FORBIDDEN",
  "NOT_FOUND",
  "IMMUTABLE_VERSION",
  "INVALID_TRANSITION",
  "CONFLICT",
]);

/** MODEL_ERROR and anything unexpected is retried while attempts remain; rule violations are not. */
export function toRunFailure(e: unknown): RunFailure {
  if (e instanceof RunFailure) return e;
  if (isAppError(e)) return new RunFailure(e.code, e.message, !NON_RETRYABLE.has(e.code));
  return new RunFailure("INTERNAL", errorMessage(e), true);
}
