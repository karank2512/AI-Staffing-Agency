import { vi } from "vitest";
import type { SessionContext } from "@/server/auth/types";

/** Silence (and capture) console.error for tests that exercise a logged-and-swallowed failure path. */
export function captureConsoleError() {
  return vi.spyOn(console, "error").mockImplementation(() => undefined);
}

/** Set/unset env vars for one test; call the returned function to restore the previous values. */
export function withEnv(patch: Record<string, string | undefined>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

export function asRole(session: SessionContext, role: SessionContext["role"]): SessionContext {
  return { ...session, role };
}

/** Rejects → returns the error; resolves → fails the test. Lets assertions inspect AppError.code. */
export async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error("Expected the promise to reject, but it resolved");
}
