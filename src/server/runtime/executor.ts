import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { config } from "@/server/config";
import { log } from "./log";
import { claimNextRun, recoverStaleRuns } from "./queue";
import { executeRun } from "./run";
import { tickScheduler } from "./scheduler";

/**
 * In-process executor: a polling loop that claims QUEUED runs and executes them, plus the periodic stale-lock
 * recovery and scheduler ticks. It shares NO memory with request handlers (Next.js bundles them separately):
 * every decision is made from the database. The registry lives on globalThis so a dev-server reload replaces the
 * previous loop instead of stacking a second one.
 */

interface ExecutorRegistry {
  generation: number;
  stop: () => Promise<void>;
}

const registry = globalThis as unknown as { __aiStaffingExecutor?: ExecutorRegistry };

function sleeper() {
  let wake: (() => void) | undefined;
  return {
    sleep: (ms: number) =>
      new Promise<void>((resolve) => {
        wake = resolve;
        const timer = setTimeout(resolve, ms);
        timer.unref?.();
      }),
    wake: () => wake?.(),
  };
}

export function startExecutor(): void {
  const previous = registry.__aiStaffingExecutor;
  if (previous) void previous.stop();
  const generation = (previous?.generation ?? 0) + 1;
  const executorId = `${hostname()}-${process.pid}-g${generation}-${randomUUID().slice(0, 6)}`;

  let running = true;
  const inFlight = new Set<Promise<void>>();
  const { sleep, wake } = sleeper();
  let lastRecovery = 0;
  let lastSchedule = 0;

  const launch = (runId: string) => {
    const task: Promise<void> = executeRun(runId, { executorId })
      .then((outcome) => log.info(`run ${runId} → ${outcome.status}`))
      .catch((e: unknown) => log.error(`run ${runId} crashed`, e))
      .finally(() => inFlight.delete(task));
    inFlight.add(task);
  };

  const tick = async () => {
    const now = Date.now();
    if (now - lastRecovery >= config.executor.staleLockMs / 2) {
      lastRecovery = now;
      try {
        const n = await recoverStaleRuns();
        if (n > 0) log.warn(`recovered ${n} stale run${n === 1 ? "" : "s"}`);
      } catch (e) {
        log.error("stale-run recovery failed", e);
      }
    }
    if (now - lastSchedule >= config.executor.schedulerTickMs) {
      lastSchedule = now;
      try {
        const n = await tickScheduler();
        if (n > 0) log.info(`scheduler queued ${n} run${n === 1 ? "" : "s"}`);
      } catch (e) {
        log.error("scheduler tick failed", e);
      }
    }
    while (running && inFlight.size < Math.max(1, config.executor.concurrency)) {
      const runId = await claimNextRun(executorId);
      if (!runId) break;
      log.info(`claimed run ${runId}`);
      launch(runId);
    }
  };

  const loop = (async () => {
    log.info(`started (${executorId}, concurrency ${config.executor.concurrency}, poll ${config.executor.pollMs}ms)`);
    while (running) {
      try {
        await tick();
      } catch (e) {
        log.error("poll failed", e);
      }
      if (running) await sleep(config.executor.pollMs);
    }
    await Promise.allSettled([...inFlight]);
    log.info(`stopped (${executorId})`);
  })();

  registry.__aiStaffingExecutor = {
    generation,
    stop: async () => {
      running = false;
      wake();
      await loop;
    },
  };
}

/** Stops the polling loop and waits for in-flight runs to finish their current slice. */
export async function stopExecutor(): Promise<void> {
  const current = registry.__aiStaffingExecutor;
  if (!current) return;
  registry.__aiStaffingExecutor = undefined;
  await current.stop();
}
