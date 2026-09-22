import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Stat, StatStrip } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { statusLabel } from "@/lib/status";
import { requireSession } from "@/server/auth";
import { countDeliverables, isDeliverableStatus, listDeliverables, listDeliverableWorkers } from "@/server/queries/deliverables";
import { SegmentedLinks, withParams } from "../runs/_components/segmented";
import { WorkerFilter } from "../runs/_components/worker-filter";
import { DeliverableRows } from "./_components/deliverable-rows";

export const metadata: Metadata = { title: "Deliverables" };

const STATUS_FILTERS = ["PENDING_REVIEW", "ACCEPTED", "REJECTED"] as const;

export default async function DeliverablesPage({ searchParams }: { searchParams: Promise<{ status?: string; worker?: string }> }) {
  const s = await requireSession();
  const { status: rawStatus, worker: rawWorker } = await searchParams;
  const status = isDeliverableStatus(rawStatus) ? rawStatus : undefined;
  const workerId = rawWorker || undefined;

  const [items, workers, counts] = await Promise.all([
    listDeliverables(s.organizationId, { status, workerId }),
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
        description="Everything your workers have handed in — read it, accept it, or send it back."
        backHref="/workforce"
        backLabel="Workforce"
      />

      <div className="space-y-14">
        <StatStrip>
          <Stat label="Handed in" value={counts.total} />
          <Stat
            label="Waiting for you"
            value={counts.pendingReview}
            hint={counts.pendingReview > 0 ? "Your verdict feeds their score" : "All caught up"}
          />
          <Stat label="Accepted" value={counts.accepted} />
          <Stat label="Sent back" value={counts.rejected} />
        </StatStrip>

        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedLinks
              label="Filter deliverables by status"
              options={[
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
              <WorkerFilter basePath="/deliverables" workers={workers} selected={workerId ?? null} preserve={{ status }} />
            ) : null}
          </div>

          {items.length === 0 ? (
            <Card>
              <EmptyState
                title={filtered ? "Nothing matches these filters" : "Nothing handed in yet"}
                description={
                  filtered
                    ? "Try a different status, or look at everyone's work."
                    : "Reports and datasets land here as soon as a worker finishes their first run."
                }
                action={
                  filtered ? (
                    <Button variant="secondary" size="lg" asChild>
                      <Link href="/deliverables">Show everything</Link>
                    </Button>
                  ) : (
                    <Button size="lg" asChild>
                      <Link href="/workforce">Go to your workforce</Link>
                    </Button>
                  )
                }
              />
            </Card>
          ) : (
            <DeliverableRows items={items} />
          )}
        </div>
      </div>
    </>
  );
}
