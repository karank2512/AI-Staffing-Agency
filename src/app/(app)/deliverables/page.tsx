import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, FileText, Inbox, XCircle } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RelativeTime } from "@/components/relative-time";
import { ScoreRing } from "@/components/score-ring";
import { SimulatedBadge } from "@/components/simulated-badge";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { WorkerAvatar } from "@/components/worker-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { pluralize } from "@/lib/format";
import { statusLabel } from "@/lib/status";
import { requireSession } from "@/server/auth";
import { countDeliverables, isDeliverableStatus, listDeliverables, listDeliverableWorkers } from "@/server/queries/deliverables";
import { FilterChips, withParams } from "../runs/_components/filter-chips";

export const metadata: Metadata = { title: "Deliverables" };

const STATUS_FILTERS = ["PENDING_REVIEW", "ACCEPTED", "REJECTED"] as const;
const FORMAT_LABEL = { MARKDOWN: "Report", CSV: "CSV", JSON: "JSON" } as const;

export default async function DeliverablesPage({ searchParams }: { searchParams: Promise<{ status?: string; worker?: string }> }) {
  const s = await requireSession();
  const { status: rawStatus, worker: workerId } = await searchParams;
  const status = isDeliverableStatus(rawStatus) ? rawStatus : undefined;

  const [items, workers, counts] = await Promise.all([
    listDeliverables(s.organizationId, { status, workerId: workerId || undefined }),
    listDeliverableWorkers(s.organizationId),
    countDeliverables(s.organizationId),
  ]);
  const filtered = Boolean(status || workerId);
  const countFor = (value: (typeof STATUS_FILTERS)[number]) =>
    value === "PENDING_REVIEW" ? counts.pendingReview : value === "ACCEPTED" ? counts.accepted : counts.rejected;

  return (
    <>
      <PageHeader
        title="Deliverables"
        description="Everything your workers have handed in — review it, accept it, or send it back."
        breadcrumbs={[{ label: "Workforce", href: "/workforce" }, { label: "Deliverables" }]}
      />
      <div className="space-y-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Delivered" value={counts.total} icon={FileText} />
          <StatCard label="Awaiting your review" value={counts.pendingReview} icon={Inbox} hint={counts.pendingReview > 0 ? "Your verdict feeds each worker’s score" : "All caught up"} />
          <StatCard label="Accepted" value={counts.accepted} icon={CheckCircle2} />
          <StatCard label="Sent back" value={counts.rejected} icon={XCircle} />
        </div>

        <div className="space-y-3">
          <FilterChips
            label="Status"
            chips={[
              { label: "All", href: withParams("/deliverables", { worker: workerId }), active: !status, count: counts.total },
              ...STATUS_FILTERS.map((value) => ({
                label: statusLabel("deliverable", value),
                href: withParams("/deliverables", { status: value, worker: workerId }),
                active: status === value,
                count: countFor(value),
              })),
            ]}
          />
          {workers.length > 1 ? (
            <FilterChips
              label="Worker"
              chips={[
                { label: "Everyone", href: withParams("/deliverables", { status }), active: !workerId },
                ...workers.map((w) => ({ label: w.name, href: withParams("/deliverables", { status, worker: w.id }), active: workerId === w.id })),
              ]}
            />
          ) : null}
        </div>

        {items.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={filtered ? "Nothing matches these filters" : "No deliverables yet"}
            description={filtered ? "Try widening the filters." : "Your workers’ reports and datasets will show up here after their first run."}
            action={
              filtered ? (
                <Button variant="outline" asChild>
                  <Link href="/deliverables">Clear filters</Link>
                </Button>
              ) : (
                <Button asChild>
                  <Link href="/workforce">Go to Workforce</Link>
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
                    <TableHead className="pl-6">Deliverable</TableHead>
                    <TableHead>Worker</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead className="pr-6">Delivered</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="max-w-md pl-6">
                        <Link href={`/deliverables/${d.id}`} className="block truncate font-medium hover:underline">
                          {d.title}
                        </Link>
                        <p className="truncate text-xs text-muted-foreground">
                          {d.job.title}
                          {d.recordCount !== null ? ` · ${pluralize(d.recordCount, "record")}` : ""}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Link href={`/workers/${d.worker.id}`} className="flex items-center gap-2 hover:underline">
                          <WorkerAvatar name={d.worker.name} color={d.worker.avatarColor} size="sm" />
                          {d.worker.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <span className="flex items-center gap-2">
                          {FORMAT_LABEL[d.format]}
                          {d.run.simulated ? <SimulatedBadge /> : null}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge kind="deliverable" status={d.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="inline-flex justify-end">
                          <ScoreRing score={d.score} size={28} />
                        </span>
                      </TableCell>
                      <TableCell className="pr-6 text-muted-foreground">
                        <RelativeTime iso={d.createdAt} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
