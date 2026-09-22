import type { RunTrigger } from "@prisma/client";
import { EmptyState } from "@/components/empty-state";
import { RelativeTime } from "@/components/relative-time";
import { SimulatedBadge } from "@/components/simulated-badge";
import { StatusBadge } from "@/components/status-badge";
import { formatDuration, formatUsdPrecise } from "@/lib/format";
import type { WorkerRunRow } from "@/server/queries/worker-profile";
import { Row, RowList, RowMeta, RowTitle, RowValue, Sep } from "./rows";

export interface RunsTableProps {
  runs: WorkerRunRow[];
  workerName: string;
  /** Overview: hide the version and simulated markers so the list stays a glance. */
  compact?: boolean;
}

const HEADLINES: Record<RunTrigger, string> = {
  MANUAL: "Run on request",
  SCHEDULED: "Scheduled run",
  RETRY: "Retry of an earlier run",
  CHAT: "Run asked for in a conversation",
  HIRE: "First run after hiring",
};

/** Runs as a readable list: one sentence per run, the numbers demoted to the right. */
export function RunsTable({ runs, workerName, compact = false }: RunsTableProps) {
  if (runs.length === 0) {
    return (
      <RowList>
        <li>
          <EmptyState
            title="No runs yet"
            description={`${workerName} hasn't started working yet. "Run now" kicks off the first run.`}
            className="py-16"
          />
        </li>
      </RowList>
    );
  }

  return (
    <RowList>
      {runs.map((run) => (
        <Row key={run.id} href={`/runs/${run.id}`}>
          <div className="min-w-0 flex-1">
            <RowTitle>
              {HEADLINES[run.trigger] ?? "Run"}
              {run.attempt > 1 ? <span className="font-normal text-muted-foreground"> · attempt {run.attempt}</span> : null}
            </RowTitle>
            <RowMeta>
              <StatusBadge kind="run" status={run.status} emphasis="dot" />
              <Sep />
              <RelativeTime iso={run.startedAt ?? run.createdAt} />
              {run.deliverableCount > 0 ? (
                <>
                  <Sep />
                  <span>{run.deliverableCount === 1 ? "1 deliverable" : `${run.deliverableCount} deliverables`}</span>
                </>
              ) : null}
              {!compact ? (
                <>
                  <Sep />
                  <span className="metric">v{run.version}</span>
                  {run.simulated ? <SimulatedBadge /> : null}
                </>
              ) : null}
            </RowMeta>
            {run.status === "FAILED" && run.error ? (
              <p className="text-footnote mt-1 line-clamp-1 text-danger" title={run.error}>
                {run.error}
              </p>
            ) : null}
          </div>
          <RowValue className="pt-0.5">
            <span className="block text-foreground">{formatUsdPrecise(run.costUsd)}</span>
            <span className="mt-0.5 block">{formatDuration(run.durationMs)}</span>
          </RowValue>
        </Row>
      ))}
    </RowList>
  );
}
