"use client";

import { Clock, Coins, Hash, PlayCircle } from "lucide-react";
import { RelativeTime } from "@/components/relative-time";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { formatDuration, formatTokens, formatUsd } from "@/lib/format";
import { useRunLive } from "./run-live";

/** The run's status badge, kept current by the live poller (pulses while RUNNING via StatusBadge). */
export function LiveRunStatus({ className }: { className?: string }) {
  const { live } = useRunLive();
  return <StatusBadge kind="run" status={live.run.status} className={className} />;
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
        value={run.durationMs !== null ? formatDuration(run.durationMs) : inFlight ? "In progress" : "—"}
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
