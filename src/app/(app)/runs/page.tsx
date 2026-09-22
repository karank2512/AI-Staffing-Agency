import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { EmptyState } from "@/components/empty-state";
import { LiveDot } from "@/components/live-dot";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { statusLabel } from "@/lib/status";
import { requireSession } from "@/server/auth";
import { isRunStatus, listRuns, listRunWorkers } from "@/server/queries/runs";
import { RunRows } from "./_components/run-rows";
import { SegmentedLinks, withParams } from "./_components/segmented";
import { WorkerFilter } from "./_components/worker-filter";

export const metadata: Metadata = { title: "Runs" };

const STATUS_FILTERS = ["QUEUED", "RUNNING", "WAITING_FOR_APPROVAL", "SUCCEEDED", "FAILED", "CANCELLED"] as const;

export default async function RunsPage({ searchParams }: { searchParams: Promise<{ status?: string; worker?: string }> }) {
  const s = await requireSession();
  const { status: rawStatus, worker: rawWorker } = await searchParams;
  const status = isRunStatus(rawStatus) ? rawStatus : undefined;
  const workerId = rawWorker || undefined;

  const [runs, workers] = await Promise.all([
    listRuns(s.organizationId, { status, workerId, limit: 100 }),
    listRunWorkers(s.organizationId),
  ]);
  const inFlight = runs.some((r) => r.status === "QUEUED" || r.status === "RUNNING");
  const filtered = Boolean(status || workerId);

  return (
    <>
      <PageHeader
        title="Runs"
        description="Every time one of your workers picked up the job — live and past."
        backHref="/workforce"
        backLabel="Workforce"
      />

      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedLinks
            label="Filter runs by status"
            options={[
              { label: "All", href: withParams("/runs", { worker: workerId }), active: !status },
              ...STATUS_FILTERS.map((value) => ({
                label: statusLabel("run", value),
                href: withParams("/runs", { status: value, worker: workerId }),
                active: status === value,
              })),
            ]}
          />
          {workers.length > 1 ? (
            <WorkerFilter basePath="/runs" workers={workers} selected={workerId ?? null} preserve={{ status }} />
          ) : null}
          {inFlight ? <LiveDot className="ml-auto" /> : null}
        </div>

        {runs.length === 0 ? (
          <Card>
            <EmptyState
              title={filtered ? "Nothing matches these filters" : "No runs yet"}
              description={
                filtered
                  ? "Try a wider status, or look at everyone's work."
                  : "Hire a worker and the first thing they do lands here, step by step."
              }
              action={
                filtered ? (
                  <Button variant="secondary" size="lg" asChild>
                    <Link href="/runs">Show all runs</Link>
                  </Button>
                ) : (
                  <Button size="lg" asChild>
                    <Link href="/hire">Hire a worker</Link>
                  </Button>
                )
              }
            />
          </Card>
        ) : (
          <RunRows runs={runs} />
        )}
      </div>

      <AutoRefresh active={inFlight} />
    </>
  );
}
