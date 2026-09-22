import type { WorkerHealth } from "@prisma/client";
import { HEALTH_THRESHOLDS } from "@/server/domain/evaluation";

/** PURE health decision — the DB side lives in score.ts (`refreshWorkerHealth`). */

export type FinishedStatus = "SUCCEEDED" | "FAILED";

export interface HealthInput {
  /** Worker score 0..100 (null = nothing evaluated yet). */
  score: number | null;
  /** Finished runs of the worker's current version, MOST RECENT FIRST. Only the recent window is read. */
  recentStatuses: readonly FinishedStatus[];
}

export interface HealthVerdict {
  health: WorkerHealth;
  /** Human-readable cause, only for NEEDS_ATTENTION. */
  reason: string | null;
}

export function recentFailures(recentStatuses: readonly FinishedStatus[]): { failed: number; total: number } {
  const window = recentStatuses.slice(0, HEALTH_THRESHOLDS.recentRunWindow);
  return { failed: window.filter((s) => s === "FAILED").length, total: window.length };
}

export function assessHealth({ score, recentStatuses }: HealthInput): HealthVerdict {
  if (recentStatuses.length < HEALTH_THRESHOLDS.minRunsForHealth) return { health: "UNKNOWN", reason: null };

  const reasons: string[] = [];
  if (score !== null && score < HEALTH_THRESHOLDS.minScore) {
    // floor, not round: 64.6 must never read "Quality score 65 is below the 65 threshold".
    reasons.push(`Quality score ${Math.floor(score)} is below the ${HEALTH_THRESHOLDS.minScore} threshold`);
  }
  const { failed, total } = recentFailures(recentStatuses);
  if (total > 0 && failed / total > HEALTH_THRESHOLDS.maxRecentFailureRate) {
    reasons.push(`${failed} of the last ${total} runs failed`);
  }

  if (reasons.length === 0) return { health: "HEALTHY", reason: null };
  const [first, ...rest] = reasons;
  return { health: "NEEDS_ATTENTION", reason: [first, ...rest.map((r) => r.charAt(0).toLowerCase() + r.slice(1))].join(" and ") };
}
