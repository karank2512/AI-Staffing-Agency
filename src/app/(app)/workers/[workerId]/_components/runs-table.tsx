import Link from "next/link";
import { ArrowUpRight, PlayCircle } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { RelativeTime } from "@/components/relative-time";
import { SimulatedBadge } from "@/components/simulated-badge";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDuration, formatUsdPrecise, pluralize } from "@/lib/format";
import type { WorkerRunRow } from "@/server/queries/worker-profile";
import { triggerLabel } from "./labels";

export interface RunsTableProps {
  runs: WorkerRunRow[];
  workerName: string;
  /** Hide the steps / version columns (overview card). */
  compact?: boolean;
}

/** App-entity table (not DataTable — that one is for worker-produced records). */
export function RunsTable({ runs, workerName, compact = false }: RunsTableProps) {
  if (runs.length === 0) {
    return (
      <EmptyState
        icon={PlayCircle}
        title="No runs yet"
        description={`${workerName} hasn't started working yet. Use "Run now" to kick off the first run.`}
        className="py-8"
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Status</TableHead>
          <TableHead>Trigger</TableHead>
          <TableHead>Started</TableHead>
          <TableHead className="text-right">Duration</TableHead>
          <TableHead className="text-right">Cost</TableHead>
          {compact ? null : <TableHead className="text-right">Steps</TableHead>}
          {compact ? null : <TableHead className="text-right">Version</TableHead>}
          <TableHead className="w-0">
            <span className="sr-only">Open</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <TableRow key={run.id}>
            <TableCell>
              <div className="flex items-center gap-2">
                <StatusBadge kind="run" status={run.status} />
                {run.simulated && !compact ? <SimulatedBadge /> : null}
              </div>
              {run.status === "FAILED" && run.error ? (
                <p className="mt-1 max-w-xs truncate text-xs text-rose-600" title={run.error}>
                  {run.error}
                </p>
              ) : null}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {triggerLabel(run.trigger)}
              {run.attempt > 1 ? <span className="ml-1 text-xs">· attempt {run.attempt}</span> : null}
            </TableCell>
            <TableCell className="text-muted-foreground">
              <RelativeTime iso={run.startedAt ?? run.createdAt} />
            </TableCell>
            <TableCell className="metric text-right">{formatDuration(run.durationMs)}</TableCell>
            <TableCell className="metric text-right">{formatUsdPrecise(run.costUsd)}</TableCell>
            {compact ? null : <TableCell className="metric text-right">{run.stepsCount}</TableCell>}
            {compact ? null : <TableCell className="metric text-right text-muted-foreground">v{run.version}</TableCell>}
            <TableCell className="text-right">
              <Link
                href={`/runs/${run.id}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
                aria-label={`Open run from ${triggerLabel(run.trigger).toLowerCase()} with ${pluralize(run.stepsCount, "step")}`}
              >
                Open
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
