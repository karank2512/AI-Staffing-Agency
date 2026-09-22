/** Central, typed access to runtime configuration. Read lazily so tests can mutate process.env. */
const bool = (v: string | undefined) => v === "1" || v?.toLowerCase() === "true";
const num = (v: string | undefined, fallback: number) => {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

export const config = {
  get forceSimulated() {
    return bool(process.env.FORCE_SIMULATED);
  },
  executor: {
    get disabled() {
      return bool(process.env.EXECUTOR_DISABLED);
    },
    get pollMs() {
      return num(process.env.EXECUTOR_POLL_MS, 1000);
    },
    get concurrency() {
      return num(process.env.EXECUTOR_CONCURRENCY, 2);
    },
    /** A RUNNING run whose heartbeat is older than this is considered crashed and is recovered. */
    get staleLockMs() {
      return num(process.env.EXECUTOR_STALE_LOCK_MS, 120_000);
    },
    get schedulerTickMs() {
      return num(process.env.SCHEDULER_TICK_MS, 30_000);
    },
  },
  usage: {
    /** billableUsd = costUsd × marginMultiplier */
    get marginMultiplier() {
      return num(process.env.USAGE_MARGIN_MULTIPLIER, 1.4);
    },
  },
} as const;
