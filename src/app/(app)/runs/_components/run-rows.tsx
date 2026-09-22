import Link from "next/link";
import { RelativeTime } from "@/components/relative-time";
import { StatusBadge } from "@/components/status-badge";
import { WorkerAvatar } from "@/components/worker-avatar";
import { Card } from "@/components/ui/card";
import { formatDuration, formatUsd } from "@/lib/format";
import type { RunListItem } from "@/server/queries/runs";
import { isTerminal } from "@/server/runtime/types";
import { TRIGGER_LABEL } from "../[runId]/_components/step-meta";

/**
 * The runs index as hairline rows rather than a grid of boxes: one sentence per run on the left, quiet facts
 * on the right. Below 640px the facts wrap under the sentence instead of squeezing into columns.
 */

function activeTime(run: RunListItem): string {
  if (run.durationMs === null) return run.status === "RUNNING" ? "running" : "—";
  return isTerminal(run.status) ? formatDuration(run.durationMs) : `${formatDuration(run.durationMs)} so far`;
}

function subtitle(run: RunListItem): string {
  const parts = [run.worker.name, TRIGGER_LABEL[run.trigger]];
  if (run.attempt > 1) parts.push(`attempt ${run.attempt}`);
  if (run.deliverable) parts.push(run.deliverable.title);
  return parts.join(" · ");
}

export function RunRows({ runs }: { runs: RunListItem[] }) {
  return (
    <Card className="gap-0 py-0">
      <div className="hidden items-center gap-6 border-b border-border px-6 text-[13px] font-semibold text-muted-foreground sm:flex sm:h-11">
        <span className="min-w-0 flex-1">Run</span>
        <span className="w-36">Status</span>
        <span className="w-24 text-right">Active time</span>
        <span className="w-20 text-right">Cost</span>
        <span className="w-28 text-right">Started</span>
      </div>

      <ul>
        {runs.map((run) => (
          <li
            key={run.id}
            className="relative not-last:after:pointer-events-none not-last:after:absolute not-last:after:inset-x-6 not-last:after:bottom-0 not-last:after:h-px not-last:after:bg-border"
          >
            <Link
              href={`/runs/${run.id}`}
              className="group/row flex flex-col gap-2.5 px-6 py-4 outline-none transition-colors duration-200 ease-standard hover:bg-[#f9f9fb] focus-visible:bg-[#f9f9fb] sm:h-16 sm:flex-row sm:items-center sm:gap-6 sm:py-0"
            >
              <span className="flex min-w-0 flex-1 items-center gap-3">
                <WorkerAvatar name={run.worker.name} color={run.worker.avatarColor} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground group-hover/row:text-link">{run.job.title}</span>
                  <span className="block truncate text-footnote text-muted-foreground">{subtitle(run)}</span>
                </span>
              </span>

              {/* Desktop: aligned columns. */}
              <span className="hidden w-36 shrink-0 sm:block">
                <StatusBadge kind="run" status={run.status} />
              </span>
              <span className="metric hidden w-24 shrink-0 text-right text-footnote text-muted-foreground sm:block">
                {activeTime(run)}
              </span>
              <span className="metric hidden w-20 shrink-0 text-right text-footnote text-muted-foreground sm:block">
                {formatUsd(run.costUsd)}
              </span>
              <span className="hidden w-28 shrink-0 text-right text-footnote text-muted-foreground sm:block">
                <RelativeTime iso={run.createdAt} />
              </span>

              {/* Mobile: the same facts, wrapped under the sentence. */}
              <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-11 text-footnote text-muted-foreground sm:hidden">
                <StatusBadge kind="run" status={run.status} />
                <span aria-hidden="true">·</span>
                <span className="metric">{activeTime(run)}</span>
                <span aria-hidden="true">·</span>
                <span className="metric">{formatUsd(run.costUsd)}</span>
                <span aria-hidden="true">·</span>
                <RelativeTime iso={run.createdAt} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
