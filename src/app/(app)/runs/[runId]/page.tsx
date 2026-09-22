import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, MessageSquareText, TriangleAlert } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { EmptyState } from "@/components/empty-state";
import { Section } from "@/components/section";
import { SimulatedBadge } from "@/components/simulated-badge";
import { StatusBadge } from "@/components/status-badge";
import { WorkerAvatar } from "@/components/worker-avatar";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatNumber, pluralize } from "@/lib/format";
import { requireSession } from "@/server/auth";
import { isAppError } from "@/server/errors";
import { getRunDetail, type RunDetail, type RunStepDetailView } from "@/server/queries/runs";
import { EvaluationCards } from "../_components/evaluation-cards";
import { DebugTrace } from "./_components/debug-trace";
import { LiveRunStats, LiveRunStatus } from "./_components/live-header";
import { RunActions } from "./_components/run-actions";
import { RunLiveProvider } from "./_components/run-live";
import { RunTimeline } from "./_components/run-timeline";
import { TRIGGER_LABEL } from "./_components/step-meta";

export const metadata: Metadata = { title: "Run" };

async function load(organizationId: string, runId: string): Promise<RunDetail> {
  try {
    return await getRunDetail(organizationId, runId);
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const s = await requireSession();
  const detail = await load(s.organizationId, runId);
  const { live, worker, job, version } = detail;
  const run = live.run;

  const stepDetails: Record<string, RunStepDetailView> = Object.fromEntries(detail.steps.map((step) => [step.id, step]));
  const firstDeliverable = detail.deliverables[0] ?? null;
  const possessive = worker.name.endsWith("s") ? `${worker.name}’` : `${worker.name}’s`;

  return (
    <RunLiveProvider runId={run.id} initial={live}>
      <PageHeader
        breadcrumbs={[{ label: "Workforce", href: "/workforce" }, { label: worker.name, href: `/workers/${worker.id}` }, { label: "Run" }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Link href={`/workers/${worker.id}`} className="flex items-center gap-2 hover:underline">
              <WorkerAvatar name={worker.name} color={worker.avatarColor} size="md" />
              {possessive} run
            </Link>
            <LiveRunStatus />
            {run.simulated ? <SimulatedBadge /> : null}
          </span>
        }
        description={
          <>
            <Link href={`/jobs/${job.id}`} className="hover:underline">
              {job.title}
            </Link>
            {" · "}v{version.version}{" · "}
            {TRIGGER_LABEL[run.trigger]}
            {run.attempt > 1 ? ` · attempt ${run.attempt} of ${run.maxAttempts}` : ""}
            {detail.requestedByName ? ` · requested by ${detail.requestedByName}` : ""}
          </>
        }
        actions={<RunActions runId={run.id} workerId={worker.id} workerName={worker.name} deliverable={firstDeliverable} />}
      />

      <div className="space-y-8">
        <LiveRunStats />

        {run.status === "FAILED" && run.error ? (
          <Alert variant="destructive">
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>{worker.name} couldn’t finish this run</AlertTitle>
            <AlertDescription className="text-pretty">{run.error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-8 lg:col-span-2">
            <Section title="What happened" description={`${worker.name}’s work, step by step.`}>
              <Card>
                <CardContent>
                  <RunTimeline runId={run.id} workerId={worker.id} workerName={worker.name} details={stepDetails} />
                </CardContent>
              </Card>
            </Section>

            <Section
              title="Evaluation"
              description={detail.score !== null ? `This run scores ${formatNumber(detail.score, 0)} / 100 overall.` : "How the deliverable measured up."}
            >
              <EvaluationCards
                evaluations={detail.evaluations}
                workerName={worker.name}
                emptyDescription={
                  run.status === "SUCCEEDED"
                    ? live.evaluationPending
                      ? "Checks are running now — this section updates automatically."
                      : "No evaluation was recorded for this run."
                    : run.status === "FAILED" || run.status === "CANCELLED"
                      ? "The run didn’t finish, so there was nothing to evaluate."
                      : `Automated checks and the reviewer model run as soon as ${worker.name} finishes.`
                }
              />
            </Section>

            <DebugTrace detail={detail} />
          </div>

          <div className="space-y-6">
            <Section title={detail.deliverables.length > 1 ? "Deliverables" : "Deliverable"}>
              {detail.deliverables.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title="Nothing delivered yet"
                  description={run.status === "SUCCEEDED" || run.status === "FAILED" || run.status === "CANCELLED" ? "This run didn’t produce a deliverable." : `${worker.name} is still working on it.`}
                  className="py-8"
                />
              ) : (
                <div className="grid gap-4">
                  {detail.deliverables.map((d) => (
                    <Card key={d.id}>
                      <CardHeader>
                        <CardTitle className="text-pretty">
                          <Link href={`/deliverables/${d.id}`} className="hover:underline">
                            {d.title}
                          </Link>
                        </CardTitle>
                        <CardDescription>
                          {d.format}
                          {d.recordCount !== null ? ` · ${pluralize(d.recordCount, "record")}` : ""}
                          {" · "}
                          {formatDateTime(d.createdAt)}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <StatusBadge kind="deliverable" status={d.status} />
                        {d.summary ? <p className="line-clamp-4 text-sm text-pretty text-muted-foreground">{d.summary}</p> : null}
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/deliverables/${d.id}`}>
                            <FileText aria-hidden="true" /> Open deliverable
                          </Link>
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </Section>

            {detail.input.instructions.length > 0 ? (
              <Section title="One-off instructions" description={`Applied to this run only.`}>
                <Card>
                  <CardContent>
                    <ul className="space-y-2">
                      {detail.input.instructions.map((text, i) => (
                        <li key={i} className="flex gap-2 text-sm">
                          <MessageSquareText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="text-pretty">{text}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </Section>
            ) : null}

            <Section title="Details">
              <Card>
                <CardContent>
                  <dl className="divide-y">
                    <DetailRow label="Worker">
                      <Link href={`/workers/${worker.id}`} className="hover:underline">
                        {worker.name}
                      </Link>
                      <span className="text-muted-foreground"> · {worker.title}</span>
                    </DetailRow>
                    <DetailRow label="Job">
                      <Link href={`/jobs/${job.id}`} className="hover:underline">
                        {job.title}
                      </Link>
                    </DetailRow>
                    <DetailRow label="Version">
                      <Link href={`/workers/${worker.id}?tab=versions`} className="hover:underline">
                        v{version.version}
                      </Link>
                      <StatusBadge kind="version" status={version.status} className="ml-2" />
                    </DetailRow>
                    <DetailRow label="Trigger">{TRIGGER_LABEL[run.trigger]}</DetailRow>
                    <DetailRow label="Attempt">
                      {run.attempt} of {run.maxAttempts}
                    </DetailRow>
                    <DetailRow label="Queued">{formatDateTime(run.createdAt)}</DetailRow>
                    <DetailRow label="Started">{run.startedAt ? formatDateTime(run.startedAt) : "—"}</DetailRow>
                    <DetailRow label="Finished">{run.finishedAt ? formatDateTime(run.finishedAt) : "—"}</DetailRow>
                    <DetailRow label="Model calls">{detail.usage.modelCalls}</DetailRow>
                    <DetailRow label="Tool calls">{detail.usage.toolCalls}</DetailRow>
                    <DetailRow label="Run id">
                      <span className="inline-flex items-center gap-1 font-mono text-xs">
                        {run.id.slice(0, 12)}…
                        <CopyButton value={run.id} />
                      </span>
                    </DetailRow>
                  </dl>
                </CardContent>
              </Card>
            </Section>
          </div>
        </div>
      </div>
    </RunLiveProvider>
  );
}
