import Link from "next/link";
import { ArrowRight, PlayCircle } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { RelativeTime } from "@/components/relative-time";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { WorkerAvatar } from "@/components/worker-avatar";
import { EMPTY, formatDuration, formatUsdPrecise } from "@/lib/format";
import type { JobRunItem } from "@/server/queries/jobs";
import { triggerLabel } from "../../_components/labels";

/** Recent runs across every worker who has held this job, newest first. Each row opens the live run page. */
export function JobRuns({ runs, workerName }: { runs: JobRunItem[]; workerName: string | null }) {
  if (runs.length === 0) {
    return (
      <EmptyState
        icon={PlayCircle}
        title="No runs yet"
        description={workerName ? `${workerName} hasn't started working yet. Runs appear here the moment one is queued.` : "Runs appear here once a worker is hired and starts working."}
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4">Status</TableHead>
            <TableHead>Trigger</TableHead>
            <TableHead>Worker</TableHead>
            <TableHead>Started</TableHead>
            <TableHead className="text-right">Duration</TableHead>
            <TableHead className="text-right">Cost</TableHead>
            <TableHead>Deliverable</TableHead>
            <TableHead className="pr-4 text-right">
              <span className="sr-only">Open</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.id}>
              <TableCell className="pl-4">
                <div className="flex flex-col gap-0.5">
                  <StatusBadge kind="run" status={run.status} />
                  {run.status === "FAILED" && run.error ? (
                    <span className="max-w-[16rem] truncate text-xs text-rose-600" title={run.error}>
                      {run.error}
                    </span>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground">{triggerLabel(run.trigger)}</TableCell>
              <TableCell>
                <Link href={`/workers/${run.worker.id}`} className="inline-flex items-center gap-2 hover:underline">
                  <WorkerAvatar name={run.worker.name} color={run.worker.avatarColor} size="sm" />
                  <span>{run.worker.name}</span>
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">
                <RelativeTime iso={run.startedAt ?? run.createdAt} />
              </TableCell>
              <TableCell className="metric text-right text-muted-foreground">{formatDuration(run.durationMs)}</TableCell>
              <TableCell className="metric text-right">{run.costUsd > 0 ? formatUsdPrecise(run.costUsd) : <span className="text-muted-foreground">{EMPTY}</span>}</TableCell>
              <TableCell className="max-w-[18rem]">
                {run.deliverable ? (
                  <Link href={`/deliverables/${run.deliverable.id}`} className="block truncate hover:underline" title={run.deliverable.title}>
                    {run.deliverable.title}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">{EMPTY}</span>
                )}
              </TableCell>
              <TableCell className="pr-4 text-right">
                <Link href={`/runs/${run.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  View
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
