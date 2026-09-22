import { logger } from "@/server/log";
import { sweepRateLimits } from "@/server/security";
import { sweepStaleHeartbeats } from "./heartbeats";
import { runRetention, type RetentionOptions, type RetentionResult } from "./retention";

/**
 * The periodic housekeeping the executor runs (see `src/server/runtime/executor.ts`). Every step is independent
 * and isolated: a failing sweep is logged and the rest still run, because maintenance must never be the reason a
 * worker stops picking up runs.
 *
 * All of it is idempotent, so several workers sweeping on their own timers is harmless — each one simply finds
 * less to do. That is deliberate: a distributed lock would be one more thing to operate, and a missed sweep costs
 * nothing but a later one.
 */

export interface MaintenanceResult {
  rateLimitBucketsDeleted: number;
  staleHeartbeatsDeleted: number;
  retention: RetentionResult | null;
  errors: string[];
}

const log = logger.child({ component: "maintenance" });

async function step<T>(name: string, fn: () => Promise<T>, errors: string[]): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    errors.push(name);
    log.error("maintenance.step_failed", { step: name, err: e });
    return null;
  }
}

export async function runMaintenance(opts: RetentionOptions = {}): Promise<MaintenanceResult> {
  const startedAt = Date.now();
  const errors: string[] = [];

  const buckets = await step("rateLimits", () => sweepRateLimits(opts.now), errors);
  const heartbeats = await step("heartbeats", () => sweepStaleHeartbeats({ now: opts.now }), errors);
  const retention = await step("retention", () => runRetention(opts), errors);

  const result: MaintenanceResult = {
    rateLimitBucketsDeleted: buckets ?? 0,
    staleHeartbeatsDeleted: heartbeats ?? 0,
    retention,
    errors,
  };
  log.info("maintenance.completed", { ...result, durationMs: Date.now() - startedAt });
  return result;
}
