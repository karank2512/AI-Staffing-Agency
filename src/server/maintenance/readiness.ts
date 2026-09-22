import { config } from "@/server/config";
import { db } from "@/server/db";
import { logger } from "@/server/log";
import migrationManifest from "@/generated/migrations.json";
import { listLiveExecutors } from "./heartbeats";

/**
 * Readiness: can this process actually serve requests right now? Two things decide that — the database answers,
 * and the schema it has is at least the schema this build was compiled against. The second check is what stops a
 * rolling deploy from serving a new build against a database the release job has not migrated yet.
 *
 * Executor liveness is reported but never fails the check: the web tier is perfectly able to serve pages while no
 * worker is running, and failing readiness would take the site down for an unrelated outage.
 */

/** Probes must answer well inside a load balancer's own timeout. */
const CHECK_TIMEOUT_MS = 2_000;

export type CheckStatus = "ok" | "fail";

export interface ReadinessReport {
  ready: boolean;
  version: string;
  checks: { database: CheckStatus; migrations: CheckStatus };
  /** Informational only. */
  executors: { live: number; inFlight: number; lastSeenAt: string | null };
}

interface MigrationRow {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

const log = logger.child({ component: "readiness" });

class TimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`${what} did not answer within ${ms}ms`);
    this.name = "TimeoutError";
  }
}

function withTimeout<T>(what: string, ms: number, work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(what, ms)), ms);
    timer.unref?.();
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** Migration names this build expects, baked in by `scripts/generate-migrations-manifest.mjs`. */
export const EXPECTED_MIGRATIONS: readonly string[] = migrationManifest.migrations;

async function checkMigrations(timeoutMs: number): Promise<CheckStatus> {
  const rows = await withTimeout(
    "migration check",
    timeoutMs,
    db.$queryRaw<MigrationRow[]>`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`,
  );
  const broken = rows.filter((r) => r.finished_at === null || r.rolled_back_at !== null);
  if (broken.length > 0) {
    log.error("readiness.migrations_unfinished", { migrations: broken.map((r) => r.migration_name) });
    return "fail";
  }
  const applied = new Set(rows.map((r) => r.migration_name));
  const missing = EXPECTED_MIGRATIONS.filter((name) => !applied.has(name));
  if (missing.length > 0) {
    log.error("readiness.migrations_missing", { missing });
    return "fail";
  }
  return "ok";
}

export async function checkReadiness(): Promise<ReadinessReport> {
  const startedAt = Date.now();
  const checks: ReadinessReport["checks"] = { database: "fail", migrations: "fail" };

  try {
    await withTimeout("database", CHECK_TIMEOUT_MS, db.$queryRaw`SELECT 1`);
    checks.database = "ok";
  } catch (e) {
    log.error("readiness.database_failed", { err: e });
  }

  if (checks.database === "ok") {
    const remaining = Math.max(250, CHECK_TIMEOUT_MS - (Date.now() - startedAt));
    try {
      checks.migrations = await checkMigrations(remaining);
    } catch (e) {
      log.error("readiness.migration_check_failed", { err: e });
    }
  }

  let executors: ReadinessReport["executors"] = { live: 0, inFlight: 0, lastSeenAt: null };
  if (checks.database === "ok") {
    try {
      const live = await withTimeout("executor heartbeats", CHECK_TIMEOUT_MS, listLiveExecutors());
      executors = {
        live: live.length,
        inFlight: live.reduce((sum, e) => sum + e.inFlight, 0),
        lastSeenAt: live[0]?.seenAt ?? null,
      };
    } catch (e) {
      log.warn("readiness.executor_check_failed", { err: e });
    }
  }

  return {
    ready: checks.database === "ok" && checks.migrations === "ok",
    version: config.appVersion,
    checks,
    executors,
  };
}
