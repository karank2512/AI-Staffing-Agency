"use client";

import type { ReactNode } from "react";
import { Clock, Coins, Hash, PlayCircle } from "lucide-react";
import { RelativeTime } from "@/components/relative-time";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { formatDuration, formatTokens, formatUsd } from "@/lib/format";
import { isTerminal, type RunLiveView } from "@/server/runtime/types";
import { useRunLive } from "./run-live";

/** The run's status badge, kept current by the live poller (pulses while RUNNING via StatusBadge). */
export function LiveRunStatus({ className }: { className?: string }) {
  const { live } = useRunLive();
  return <StatusBadge kind="run" status={live.run.status} className={className} />;
}

/**
 * Headline for the "Active time" tile. Before the run finishes, durationMs is the executor's running total (see
 * `activeTimeMs` in the runs query), so it is marked "so far"; a run that hasn't done any work yet has none.
 */
function activeTimeValue(run: RunLiveView["run"]): ReactNode {
  if (run.durationMs === null) return run.status === "RUNNING" ? "In progress" : "—";
  if (isTerminal(run.status)) return formatDuration(run.durationMs);
  return (
    <>
      {formatDuration(run.durationMs)} <span className="text-sm font-normal text-muted-foreground">so far</span>
    </>
  );
}

/** Started / duration / cost / tokens tiles. Values tick up while the run is in flight. */
export function LiveRunStats() {
  const { live } = useRunLive();
  const { run } = live;
  const inFlight = run.status === "RUNNING";
  const tokens = run.inputTokens + run.outputTokens;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Started"
        icon={PlayCircle}
        value={run.startedAt ? <RelativeTime iso={run.startedAt} /> : "Not yet"}
        hint={run.finishedAt ? <>Finished <RelativeTime iso={run.finishedAt} /></> : run.status === "QUEUED" ? "Waiting in the queue" : run.status === "WAITING_FOR_APPROVAL" ? "Paused for your approval" : inFlight ? "Working right now" : undefined}
      />
      <StatCard
        label="Active time"
        icon={Clock}
        value={activeTimeValue(run)}
        hint="Excludes time spent waiting for approvals"
      />
      <StatCard label="Cost" icon={Coins} value={formatUsd(run.costUsd)} hint={run.simulated ? "Estimated at reference model prices" : "Model and tool usage"} />
      <StatCard
        label="Tokens"
        icon={Hash}
        value={formatTokens(tokens)}
        hint={`${formatTokens(run.inputTokens)} in · ${formatTokens(run.outputTokens)} out`}
      />
    </div>
  );
}
