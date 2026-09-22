import { config } from "@/server/config";

/**
 * Next.js instrumentation hook: boots the in-process executor once per Node.js server process. The Edge runtime
 * also calls `register()`, so the runtime module (Prisma, tools…) is only imported behind the nodejs check.
 * `EXECUTOR_DISABLED=true` keeps it off (tests, one-off scripts, deployments with a dedicated worker process).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs" && !config.executor.disabled) {
    try {
      const { startExecutor } = await import("@/server/runtime");
      startExecutor();
    } catch (e) {
      console.error(e);
    }
  }
}
