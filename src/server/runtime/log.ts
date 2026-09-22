import { errorMessage } from "@/server/errors";

/** One-line, prefixed executor logging. Silent under Vitest unless RUNTIME_LOG is set, so suites stay readable. */
const quiet = () => !!process.env.VITEST && !process.env.RUNTIME_LOG;

export const log = {
  info(message: string): void {
    if (quiet()) return;
    console.log(`[executor] ${message}`);
  },
  warn(message: string): void {
    if (quiet()) return;
    console.warn(`[executor] ${message}`);
  },
  error(message: string, e?: unknown): void {
    if (quiet()) return;
    console.error(`[executor] ${message}${e !== undefined ? `: ${errorMessage(e)}` : ""}`);
  },
};
