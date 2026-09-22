import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { RelativeTime } from "@/components/relative-time";
import { StatusBadge } from "@/components/status-badge";
import { WorkerAvatar } from "@/components/worker-avatar";
import { Card } from "@/components/ui/card";
import { formatDuration, formatUsdPrecise } from "@/lib/format";
import type { JobRunItem } from "@/server/queries/jobs";
import { triggerLabel } from "../../_components/labels";

/** Recent runs across every worker who has held this job, newest first. Each row opens the live run page. */
export function JobRuns({ runs, workerName }: { runs: JobRunItem[]; workerName: string | null }) {
  if (runs.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No runs yet"
          description={
            workerName
              ? `${workerName} hasn't started working yet. Runs appear here the moment one is queued.`
              : "Runs appear here once a worker is hired and starts working."
          }
          className="py-14"
        />
      </Card>
    );
  }

  return (
    <Card className="gap-0 py-0">
      <ul>
        {runs.map((run) => {
          const facts = [
            triggerLabel(run.trigger),
            run.durationMs !== null ? formatDuration(run.durationMs) : null,
            run.costUsd > 0 ? formatUsdPrecise(run.costUsd) : null,
          ].filter(Boolean);

          return (
            <li
              key={run.id}
              className="relative not-last:after:pointer-events-none not-last:after:absolute not-last:after:inset-x-6 not-last:after:bottom-0 not-last:after:h-px not-last:after:bg-border"
            >
              <Link
                href={`/runs/${run.id}`}
                className="group/row flex flex-col gap-2 px-6 py-4 outline-none transition-colors duration-200 ease-standard hover:bg-[#f9f9fb] focus-visible:bg-[#f9f9fb] sm:flex-row sm:items-center sm:gap-6"
              >
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  <WorkerAvatar name={run.worker.name} color={run.worker.avatarColor} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground group-hover/row:text-link">
                      {run.deliverable ? run.deliverable.title : `${run.worker.name} worked on this job`}
                    </span>
                    <span className="block truncate text-footnote text-muted-foreground">
                      {facts.join(" · ")}
                      {facts.length > 0 ? " · " : ""}
                      <RelativeTime iso={run.startedAt ?? run.createdAt} />
                    </span>
                    {run.status === "FAILED" && run.error ? (
                      <span className="mt-0.5 block truncate text-footnote text-danger">{run.error}</span>
                    ) : null}
                  </span>
                </span>
                <span className="shrink-0 pl-11 sm:pl-0">
                  <StatusBadge kind="run" status={run.status} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
