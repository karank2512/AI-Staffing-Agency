import type { Metadata } from "next";
import Link from "next/link";
import { Activity, FileText } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RelativeTime } from "@/components/relative-time";
import { SimulatedBadge } from "@/components/simulated-badge";
import { StatusBadge } from "@/components/status-badge";
import { WorkerAvatar } from "@/components/worker-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDuration, formatUsd } from "@/lib/format";
import { statusLabel } from "@/lib/status";
import { requireSession } from "@/server/auth";
import { isRunStatus, listRuns, listRunWorkers } from "@/server/queries/runs";
import { isTerminal } from "@/server/runtime/types";
import { FilterChips, withParams } from "./_components/filter-chips";
import { TRIGGER_LABEL } from "./[runId]/_components/step-meta";

export const metadata: Metadata = { title: "Runs" };

const STATUS_FILTERS = ["QUEUED", "RUNNING", "WAITING_FOR_APPROVAL", "SUCCEEDED", "FAILED", "CANCELLED"] as const;

export default async function RunsPage({ searchParams }: { searchParams: Promise<{ status?: string; worker?: string }> }) {
  const s = await requireSession();
  const { status: rawStatus, worker: workerId } = await searchParams;
  const status = isRunStatus(rawStatus) ? rawStatus : undefined;

  const [runs, workers] = await Promise.all([
    listRuns(s.organizationId, { status, workerId: workerId || undefined, limit: 100 }),
    listRunWorkers(s.organizationId),
  ]);
  const inFlight = runs.some((r) => r.status === "QUEUED" || r.status === "RUNNING");
  const filtered = Boolean(status || workerId);

  return (
    <>
      <PageHeader
        title="Runs"
        description="Every time one of your workers picked up the job — live and past."
        breadcrumbs={[{ label: "Workforce", href: "/workforce" }, { label: "Runs" }]}
      />
      <div className="space-y-6">
        <div className="space-y-3">
          <FilterChips
            label="Status"
            chips={[
              { label: "All", href: withParams("/runs", { worker: workerId }), active: !status },
              ...STATUS_FILTERS.map((value) => ({
                label: statusLabel("run", value),
                href: withParams("/runs", { status: value, worker: workerId }),
                active: status === value,
              })),
            ]}
          />
          {workers.length > 1 ? (
            <FilterChips
              label="Worker"
              chips={[
                { label: "Everyone", href: withParams("/runs", { status }), active: !workerId },
                ...workers.map((w) => ({ label: w.name, href: withParams("/runs", { status, worker: w.id }), active: workerId === w.id })),
              ]}
            />
          ) : null}
        </div>

        {runs.length === 0 ? (
          <EmptyState
            icon={Activity}
            title={filtered ? "No runs match these filters" : "No runs yet"}
            description={filtered ? "Try widening the filters." : "Hire a worker and its first run will show up here."}
            action={
              filtered ? (
                <Button variant="outline" asChild>
                  <Link href="/runs">Clear filters</Link>
                </Button>
              ) : (
                <Button asChild>
                  <Link href="/hire">Hire a worker</Link>
                </Button>
              )
            }
          />
        ) : (
          <Card>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Worker</TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Trigger</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead className="text-right">Active time</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="pr-6">Deliverable</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="pl-6">
                        <Link href={`/runs/${r.id}`} className="flex items-center gap-2 font-medium hover:underline">
                          <WorkerAvatar name={r.worker.name} color={r.worker.avatarColor} size="sm" />
                          {r.worker.name}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-56 truncate text-muted-foreground">
                        <Link href={`/jobs/${r.job.id}`} className="hover:underline">
                          {r.job.title}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <StatusBadge kind="run" status={r.status} />
                          {r.simulated ? <SimulatedBadge /> : null}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {TRIGGER_LABEL[r.trigger]}
                        {r.attempt > 1 ? ` · attempt ${r.attempt}` : ""}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <RelativeTime iso={r.createdAt} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatDuration(r.durationMs)}
                        {/* Not final yet: the running total from the checkpoint. */}
                        {r.durationMs !== null && !isTerminal(r.status) ? <span className="text-muted-foreground"> so far</span> : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatUsd(r.costUsd)}</TableCell>
                      <TableCell className="pr-6">
                        {r.deliverable ? (
                          <Link href={`/deliverables/${r.deliverable.id}`} className="inline-flex max-w-56 items-center gap-1.5 truncate hover:underline">
                            <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <span className="truncate">{r.deliverable.title}</span>
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
      <AutoRefresh active={inFlight} />
    </>
  );
}
