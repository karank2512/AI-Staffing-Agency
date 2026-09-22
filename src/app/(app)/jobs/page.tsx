import type { Metadata } from "next";
import Link from "next/link";
import { Briefcase, Plus, SearchX } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
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
  const data = await listJobs(s.organizationId, { status: filter });

  const nothingAtAll = data.counts.all === 0;

  return (
    <>
      <PageHeader
        title="Jobs"
        description="Every role you've opened, who's on it, and what they've delivered."
        actions={
          <Button asChild>
            <Link href="/hire">
              <Plus aria-hidden="true" /> Hire a worker
            </Link>
          </Button>
        }
      />

      <div className="space-y-8">
        {nothingAtAll ? (
          <EmptyState
            icon={Briefcase}
            title="Hire your first worker"
            description="Describe a job in plain English and we'll scope it, design an AI worker for it and put them to work."
            action={
              <Button asChild>
                <Link href="/hire">
                  <Plus aria-hidden="true" /> Hire a worker
                </Link>
              </Button>
            }
          />
        ) : (
          <div className="space-y-4">
            <StatusFilter active={data.filter} counts={data.counts} />
            {data.jobs.length === 0 ? (
              <EmptyState
                icon={SearchX}
                title={`No ${filter ? statusLabel("job", filter).toLowerCase() : ""} jobs`}
                description="Nothing matches this filter right now."
                action={
                  <Button variant="outline" asChild>
                    <Link href="/jobs">Show all jobs</Link>
                  </Button>
                }
              />
            ) : (
              <JobsTable jobs={data.jobs} />
            )}
          </div>
        )}
      </div>

      <AutoRefresh active={data.hasRunsInFlight} />
    </>
  );
}
