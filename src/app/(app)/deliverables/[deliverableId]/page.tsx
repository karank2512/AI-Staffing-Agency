import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, Download } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { DataTable } from "@/components/data-table";
import { JsonView } from "@/components/json-view";
import { Markdown } from "@/components/markdown";
import { PageHeader } from "@/components/page-header";
import { ScoreRing } from "@/components/score-ring";
import { Section } from "@/components/section";
import { SimulatedBadge } from "@/components/simulated-badge";
import { StatusBadge } from "@/components/status-badge";
import { WorkerAvatar } from "@/components/worker-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, pluralize } from "@/lib/format";
import { requireSession } from "@/server/auth";
import { isAppError } from "@/server/errors";
import { getDeliverableDetail, type DeliverableDetail } from "@/server/queries/deliverables";
import { EvaluationCards } from "../../runs/_components/evaluation-cards";
import { ReviewPanel } from "./_components/review-panel";

export const metadata: Metadata = { title: "Deliverable" };

const FORMAT_LABEL = { MARKDOWN: "Report", CSV: "CSV", JSON: "JSON" } as const;

async function load(organizationId: string, deliverableId: string): Promise<DeliverableDetail> {
  try {
    return await getDeliverableDetail(organizationId, deliverableId);
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function Content({ d }: { d: DeliverableDetail }) {
  if (d.format === "MARKDOWN") {
    return (
      <div className="space-y-3">
        <Card>
          <CardContent>
            <Markdown content={d.content} />
          </CardContent>
        </Card>
        {/* The report's own table is capped by compile_report; the full dataset behind it is one click away. */}
        {d.rows ? (
          <details className="group">
            <summary className="cursor-pointer text-xs text-muted-foreground select-none hover:text-foreground">
              Show all {pluralize(d.rows.length, "underlying record")}
            </summary>
            <div className="mt-2">
              <DataTable rows={d.rows} maxRows={200} />
            </div>
          </details>
        ) : null}
      </div>
    );
  }
  if (d.rows) {
    return (
      <div className="space-y-3">
        <DataTable rows={d.rows} maxRows={100} />
        <details className="group">
          <summary className="cursor-pointer text-xs text-muted-foreground select-none hover:text-foreground">Show raw {FORMAT_LABEL[d.format]}</summary>
          <pre className="mt-2 max-h-96 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs whitespace-pre">{d.content}</pre>
        </details>
      </div>
    );
  }
  const parsed = d.format === "JSON" ? parseJson(d.content) : null;
  return (
    <Card>
      <CardContent>
        {parsed !== null ? (
          <JsonView label="Content" value={parsed} defaultOpen />
        ) : (
          <pre className="max-h-[32rem] overflow-auto font-mono text-xs whitespace-pre">{d.content}</pre>
        )}
      </CardContent>
    </Card>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

export default async function DeliverablePage({ params }: { params: Promise<{ deliverableId: string }> }) {
  const { deliverableId } = await params;
  const s = await requireSession();
  const d = await load(s.organizationId, deliverableId);
  const { worker, job, run } = d;

  const checks = d.evaluations.find((e) => e.type === "DETERMINISTIC") ?? null;
  const judge = d.evaluations.find((e) => e.type === "LLM_JUDGE") ?? null;
  const copyLabel = d.format === "CSV" ? "Copy CSV" : d.format === "JSON" ? "Copy JSON" : "Copy markdown";

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Workforce", href: "/workforce" },
          { label: worker.name, href: `/workers/${worker.id}` },
          { label: "Deliverables", href: "/deliverables" },
          { label: d.title },
        ]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="text-pretty">{d.title}</span>
            <StatusBadge kind="deliverable" status={d.status} />
            {run.simulated ? <SimulatedBadge /> : null}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={`/workers/${worker.id}`} className="inline-flex items-center gap-1.5 hover:underline">
              <WorkerAvatar name={worker.name} color={worker.avatarColor} size="sm" />
              {worker.name} delivered this
            </Link>
            <span>·</span>
            <span>{formatDateTime(d.createdAt)}</span>
            <span>·</span>
            <Badge variant="outline">{FORMAT_LABEL[d.format]}</Badge>
            {d.recordCount !== null ? <span>· {pluralize(d.recordCount, "record")}</span> : null}
          </span>
        }
        actions={
          <>
            <CopyButton value={d.content} label={copyLabel} className="text-foreground" />
            <Button variant="outline" asChild>
              <a href={`/deliverables/${d.id}/download`} download>
                <Download aria-hidden="true" /> Download
              </a>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/runs/${run.id}`}>
                <Activity aria-hidden="true" /> View run
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-8 lg:col-span-2">
          {d.summary ? (
            <Card className="bg-muted/30">
              <CardHeader>
                <CardTitle>In short</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-pretty">{d.summary}</p>
              </CardContent>
            </Card>
          ) : null}

          <Section title={d.format === "MARKDOWN" ? "Report" : "Records"}>
            <Content d={d} />
          </Section>

          <Section title="Evaluation" description="Automated checks, the reviewer model’s take, and your own verdict.">
            <EvaluationCards
              evaluations={d.evaluations}
              workerName={worker.name}
              emptyDescription={run.status === "SUCCEEDED" ? "Checks haven’t landed yet — refresh in a moment." : "Evaluation runs once the run completes."}
            />
          </Section>
        </div>

        <div className="space-y-6">
          <ReviewPanel
            deliverableId={d.id}
            runId={run.id}
            workerId={worker.id}
            workerName={worker.name}
            status={d.status}
            feedback={d.feedback}
            reviewedByName={d.reviewedByName}
            reviewedAt={d.reviewedAt}
          />

          <Card>
            <CardHeader>
              <CardTitle>Scores</CardTitle>
              <CardDescription>Out of 100.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-3">
                  <ScoreRing score={checks ? Math.round(checks.score * 100) : null} size={44} />
                  <div>
                    <p className="text-sm font-medium">Checks</p>
                    <p className="text-xs text-muted-foreground">{checks ? (checks.passed ? "Passed" : "Needs work") : "Not run yet"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <ScoreRing score={judge ? Math.round(judge.score * 100) : null} size={44} />
                  <div>
                    <p className="text-sm font-medium">Reviewer</p>
                    <p className="text-xs text-muted-foreground">{judge ? (judge.passed ? "Approved" : "Concerns") : "Not run yet"}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
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
                <DetailRow label="Version">v{d.version.version}</DetailRow>
                <DetailRow label="Run">
                  <Link href={`/runs/${run.id}`} className="inline-flex items-center gap-2 hover:underline">
                    <StatusBadge kind="run" status={run.status} />
                  </Link>
                </DetailRow>
                <DetailRow label="Format">{FORMAT_LABEL[d.format]}</DetailRow>
                <DetailRow label="Created">{formatDateTime(d.createdAt)}</DetailRow>
                {d.reviewedAt ? <DetailRow label="Reviewed">{formatDateTime(d.reviewedAt)}</DetailRow> : null}
                <DetailRow label="Id">
                  <span className="inline-flex items-center gap-1 font-mono text-xs">
                    {d.id.slice(0, 12)}…
                    <CopyButton value={d.id} />
                  </span>
                </DetailRow>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
