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
import { listJobs, parseJobStatusFilter } from "@/server/queries/jobs";
import { JobsTable } from "./_components/jobs-table";
import { StatusFilter } from "./_components/status-filter";

export const metadata: Metadata = { title: "Jobs" };

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const s = await requireSession();
  const { status } = await searchParams;
  const filter = parseJobStatusFilter(status);
  const data = await listJobs(s.organizationId, { status: filter, role: s.role });

  const nothingAtAll = data.counts.all === 0;
  const canHire = data.permissions["workers.hire"];

  return (
    <>
      <PageHeader title="Jobs" description="Everything you've asked for, and who's on it." />

      <div className="space-y-6">
        {nothingAtAll ? (
          <Card>
            <EmptyState
              title="Nothing on the books yet"
              description="Describe a job in plain English. We'll scope it, design a worker for it, and put them on a schedule."
              action={
                canHire ? (
                  <Button size="lg" asChild>
                    <Link href="/hire">Hire your first worker</Link>
                  </Button>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <StatusFilter active={data.filter} counts={data.counts} />
              {data.hasRunsInFlight ? <LiveDot className="ml-auto" /> : null}
            </div>

            {data.jobs.length === 0 ? (
              <Card>
                <EmptyState
                  title={`No ${filter ? statusLabel("job", filter).toLowerCase() : ""} jobs`}
                  description="Nothing matches this filter right now."
                  action={
                    <Button variant="secondary" size="lg" asChild>
                      <Link href="/jobs">Show all jobs</Link>
                    </Button>
                  }
                />
              </Card>
            ) : (
              <JobsTable jobs={data.jobs} />
            )}
          </>
        )}
      </div>

      <AutoRefresh active={data.hasRunsInFlight} />
    </>
  );
}
