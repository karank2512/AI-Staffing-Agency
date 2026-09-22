import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Coins, FileText, PlayCircle, Sparkles, UserRound } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Section } from "@/components/section";
import { SimulatedBadge } from "@/components/simulated-badge";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { WorkerAvatar } from "@/components/worker-avatar";
import { formatDate, formatUsd, pluralize } from "@/lib/format";
import { statusLabel } from "@/lib/status";
import { requireSession } from "@/server/auth";
import { isAppError } from "@/server/errors";
import { getJobDetail, type JobDetailView } from "@/server/queries/jobs";
import { JobActions } from "./_components/job-actions";
import { JobActivity } from "./_components/job-activity";
import { JobDeliverables } from "./_components/job-deliverables";
import { JobRuns } from "./_components/job-runs";
import { JobWorkers } from "./_components/job-workers";
import { SpecVersions } from "./_components/spec-versions";
import { SpecView } from "./_components/spec-view";

type Params = { params: Promise<{ jobId: string }> };

/** generateMetadata and the page both need the detail view — one set of DB round trips per request. */
const load = cache(async (jobId: string): Promise<JobDetailView | null> => {
  const s = await requireSession();
  try {
    return await getJobDetail(s.organizationId, jobId);
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") return null;
    throw e;
  }
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { jobId } = await params;
  const data = await load(jobId);
  return { title: data?.job.title ?? "Job" };
}

/** One line under the title: what kind of job, when it opened, who is on it. */
function headline(data: JobDetailView): string {
  const parts = [data.job.familyLabel, `opened ${formatDate(data.job.createdAt)}`];
  if (data.currentWorker) parts.push(`${data.currentWorker.name} is on it`);
  else if (data.job.status === "SPEC_APPROVED") parts.push("seat open");
  return parts.join(" · ");
}

export default async function JobDetailPage({ params }: Params) {
  const { jobId } = await params;
  const data = await load(jobId);
  if (!data) notFound();
  const { job, currentWorker, stats } = data;
  const shownSpec = data.specVersions.find((v) => v.shown) ?? null;
  const hireHref = `/hire?jobId=${encodeURIComponent(job.id)}`;
  const anySimulatedRun = data.runs.some((r) => r.simulated);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Jobs", href: "/jobs" }, { label: job.title }]}
        title={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            {job.title}
            <StatusBadge kind="job" status={job.status} className="translate-y-px" />
          </span>
        }
        description={headline(data)}
        actions={<JobActions jobId={job.id} title={job.title} can={data.can} currentWorker={currentWorker ? { id: currentWorker.id, name: currentWorker.name } : null} />}
      />

      <div className="space-y-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Current worker"
            icon={UserRound}
            value={
              currentWorker ? (
                <Link href={`/workers/${currentWorker.id}`} className="inline-flex items-center gap-2 text-base hover:underline">
                  <WorkerAvatar name={currentWorker.name} color={currentWorker.avatarColor} size="sm" />
                  {currentWorker.name}
                </Link>
              ) : (
                <span className="text-base text-muted-foreground">{job.status === "CLOSED" ? "Closed" : "Seat open"}</span>
              )
            }
            hint={
              currentWorker
                ? `${currentWorker.title} · ${statusLabel("worker", currentWorker.status)}`
                : data.can.hire
                  ? "Ready for a hire"
                  : data.can.continueSetup
                    ? "Finish scoping to hire"
                    : "Nobody is assigned"
            }
          />
          <StatCard label="Runs" icon={PlayCircle} value={stats.runs} hint={stats.runs > 0 ? `${stats.succeeded} completed · ${stats.failed} failed` : "No runs yet"} />
          <StatCard
            label="Deliverables"
            icon={FileText}
            value={stats.deliverables}
            hint={stats.deliverables > 0 ? `${stats.accepted} of ${stats.deliverables} accepted` : "Nothing delivered yet"}
          />
          <StatCard label="Total spend" icon={Coins} value={formatUsd(stats.totalCostUsd)} hint={stats.runs > 0 ? `across ${pluralize(stats.runs, "run")}` : "Nothing spent yet"} />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-8 lg:col-span-2">
            <Section title="Job description" description="What you asked for, as scoped and approved.">
              {data.spec ? (
                <SpecView spec={data.spec} versionLabel={shownSpec ? `v${shownSpec.version} · ${statusLabel("spec", shownSpec.status)}` : undefined} />
              ) : (
                <EmptyState
                  icon={Sparkles}
                  title="Not scoped yet"
                  description={`“${job.description.length > 140 ? `${job.description.slice(0, 140)}…` : job.description}” — answer a few questions and we'll turn it into a job description.`}
                  action={
                    data.can.continueSetup ? (
                      <Button asChild>
                        <Link href={hireHref}>Continue setup</Link>
                      </Button>
                    ) : undefined
                  }
                />
              )}
              {data.spec ? (
                <Card size="sm">
                  <CardContent>
                    <p className="eyebrow mb-1">Original request</p>
                    <blockquote className="text-sm text-pretty text-muted-foreground">“{job.description}”</blockquote>
                  </CardContent>
                </Card>
              ) : null}
            </Section>

            <Section
              title="Recent runs"
              description={data.runs.length > 0 ? `The last ${pluralize(data.runs.length, "run")} on this job.` : undefined}
              actions={anySimulatedRun ? <SimulatedBadge /> : undefined}
            >
              <JobRuns runs={data.runs} workerName={currentWorker?.name ?? null} />
            </Section>

            <Section title="Deliverables" description={stats.deliverables > 0 ? `${pluralize(stats.deliverables, "deliverable")} so far · ${stats.accepted} accepted.` : undefined}>
              <JobDeliverables deliverables={data.deliverables} />
            </Section>
          </div>

          <div className="space-y-6">
            <JobWorkers workers={data.workers} currentWorkerId={currentWorker?.id ?? null} />
            <SpecVersions versions={data.specVersions} />
            <JobActivity items={data.activity} />
          </div>
        </div>
      </div>

      <AutoRefresh active={data.hasRunsInFlight} />
    </>
  );
}
