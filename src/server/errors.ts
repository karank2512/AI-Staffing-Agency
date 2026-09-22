/** Typed application errors. Server actions map these to user-facing messages. */
export type AppErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "UNAUTHENTICATED"
  | "VALIDATION"
  | "CONFLICT"
  | "IMMUTABLE_VERSION"
  | "INVALID_TRANSITION"
  | "PERMISSION_DENIED"
  | "APPROVAL_REQUIRED"
  | "LIMIT_EXCEEDED"
  | "MODEL_ERROR"
  | "TOOL_ERROR"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details?: unknown;

  constructor(code: AppErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what: string) => new AppError("NOT_FOUND", `${what} not found`);
export const forbidden = (message = "You do not have access to this resource") =>
  new AppError("FORBIDDEN", message);
export const conflict = (message: string, details?: unknown) => new AppError("CONFLICT", message, details);
export const invalid = (message: string, details?: unknown) => new AppError("VALIDATION", message, details);

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : "Unknown error";
}
