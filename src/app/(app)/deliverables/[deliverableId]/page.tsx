import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { DataTable } from "@/components/data-table";
import { Markdown } from "@/components/markdown";
import { PageHeader } from "@/components/page-header";
import { Section } from "@/components/section";
import { SimulatedBadge } from "@/components/simulated-badge";
import { StatusBadge } from "@/components/status-badge";
import { WorkerAvatar } from "@/components/worker-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate, formatDateTime, pluralize } from "@/lib/format";
import { requireSession } from "@/server/auth";
import { isAppError } from "@/server/errors";
import { getDeliverableDetail, type DeliverableDetail } from "@/server/queries/deliverables";
import { EvaluationFindings } from "../../runs/_components/evaluation-findings";
import { FORMAT_LABEL } from "../_components/deliverable-rows";
import { ReviewPanel } from "./_components/review-panel";

export const metadata: Metadata = { title: "Deliverable" };

async function load(
  organizationId: string,
  deliverableId: string,
  role: Awaited<ReturnType<typeof requireSession>>["role"],
): Promise<DeliverableDetail> {
  try {
    return await getDeliverableDetail(organizationId, deliverableId, { role });
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
}

/** Blended automated score on 0..100, matching the deliverables index. */
function automatedScore(d: DeliverableDetail): number | null {
  const automated = d.evaluations.filter((e) => e.type !== "USER_FEEDBACK");
  if (automated.length === 0) return null;
  return Math.round((automated.reduce((s, e) => s + e.score, 0) / automated.length) * 100);
}

function Disclosure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="group/more border-t border-border">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[15px] font-medium select-none [&::-webkit-details-marker]:hidden">
        {label}
        <ChevronDown
          className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-[240ms] ease-standard group-open/more:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="pb-6">{children}</div>
    </details>
  );
}

/** The artifact itself: a report reads as an article, records read as a table in the spec's column order. */
function Artifact({ d }: { d: DeliverableDetail }) {
  if (d.format === "MARKDOWN") {
    return (
      <div className="space-y-6">
        <Card className="py-10 sm:py-14">
          <CardContent className="mx-auto w-full max-w-[692px]">
            {d.summary ? (
              <p className="text-body-lg mb-8 border-b border-border pb-8 text-pretty text-muted-foreground">{d.summary}</p>
            ) : null}
            <Markdown content={d.content} />
          </CardContent>
        </Card>
        {/* The report's own table is capped by compile_report; the full dataset behind it is one click away. */}
        {d.rows ? (
          <Disclosure label={`All ${pluralize(d.rows.length, "record")} behind this report`}>
            <DataTable rows={d.rows} columns={d.columns ?? undefined} maxRows={200} showIndex={!d.columns?.includes("rank")} />
          </Disclosure>
        ) : null}
      </div>
    );
  }

  if (d.rows) {
    return (
      <div className="space-y-6">
        {d.summary ? <p className="text-body-lg max-w-[692px] text-pretty text-muted-foreground">{d.summary}</p> : null}
        {/* Explicit columns: the stored records come out of jsonb with their keys reordered. Ranked records already
            number themselves, so the table's own "#" column would only compete with `rank`. */}
        <DataTable
          rows={d.rows}
          columns={d.columns ?? undefined}
          maxRows={100}
          showIndex={!d.columns?.includes("rank")}
          className="shadow-card"
        />
        <Disclosure label={`Show the raw ${FORMAT_LABEL[d.format]}`}>
          <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-4 font-mono text-[13px] leading-5 whitespace-pre">
            {d.content}
          </pre>
        </Disclosure>
      </div>
    );
  }

  return (
    <Card className="py-10">
      <CardContent className="mx-auto w-full max-w-[692px]">
        {d.summary ? (
          <p className="text-body-lg mb-8 border-b border-border pb-8 text-pretty text-muted-foreground">{d.summary}</p>
        ) : null}
        <pre className="max-h-[32rem] overflow-auto rounded-lg bg-muted p-4 font-mono text-[13px] leading-5 whitespace-pre">
          {d.content}
        </pre>
      </CardContent>
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2.5 text-footnote last:border-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-foreground">{children}</dd>
    </div>
  );
}

export default async function DeliverablePage({ params }: { params: Promise<{ deliverableId: string }> }) {
  const { deliverableId } = await params;
  const s = await requireSession();
  const d = await load(s.organizationId, deliverableId, s.role);
  const { worker, job, run } = d;
  const score = automatedScore(d);
  const copyLabel = d.format === "CSV" ? "Copy CSV" : d.format === "JSON" ? "Copy JSON" : "Copy text";

  return (
    <>
      <PageHeader
        backHref="/deliverables"
        backLabel="Deliverables"
        title={d.title}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-footnote text-muted-foreground">
            <Link href={`/workers/${worker.id}`} className="inline-flex items-center gap-1.5 text-link hover:underline">
              <WorkerAvatar name={worker.name} color={worker.avatarColor} size="xs" />
              {worker.name}
            </Link>
            <span aria-hidden="true">·</span>
            <span>{formatDate(d.createdAt)}</span>
            <span aria-hidden="true">·</span>
            <span className="metric">{score === null ? "Not scored yet" : `Scored ${score}`}</span>
            <span aria-hidden="true">·</span>
            <StatusBadge kind="deliverable" status={d.status} />
            {run.simulated ? <SimulatedBadge /> : null}
          </span>
        }
        actions={
          <>
            <Button variant="secondary" asChild>
              <a href={`/deliverables/${d.id}/download`} download>
                Download
              </a>
            </Button>
            <CopyButton value={d.content} label={copyLabel} className="text-link" />
            <Button variant="link" asChild>
              <Link href={`/runs/${run.id}`}>
                See the run <ChevronRight data-icon="inline-end" aria-hidden="true" />
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-12 lg:gap-10">
        <div className="space-y-14 lg:col-span-8">
          <Artifact d={d} />

          <Section title="How it measured up" description="Automated checks, the reviewer’s read, and your own verdict.">
            <EvaluationFindings
              evaluations={d.evaluations}
              workerName={worker.name}
              score={score}
              emptyDescription={
                run.status === "SUCCEEDED"
                  ? "Checks haven’t landed yet — they’ll appear here shortly."
                  : "Evaluation runs once the run completes."
              }
            />
          </Section>
        </div>

        <aside className="space-y-6 lg:col-span-4">
          <div className="lg:sticky lg:top-[88px] lg:space-y-6">
            <ReviewPanel
              deliverableId={d.id}
              runId={run.id}
              workerId={worker.id}
              workerName={worker.name}
              status={d.status}
              feedback={d.feedback}
              reviewedByName={d.reviewedByName}
              reviewedAt={d.reviewedAt}
              canReview={d.permissions["deliverables.review"]}
            />

            <Card>
              <CardContent>
                <dl>
                  <Fact label="Worker">
                    <Link href={`/workers/${worker.id}`} className="text-link hover:underline">
                      {worker.name}
                    </Link>
                  </Fact>
                  <Fact label="Job">
                    <Link href={`/jobs/${job.id}`} className="text-link hover:underline">
                      {job.title}
                    </Link>
                  </Fact>
                  <Fact label="Version">v{d.version.version}</Fact>
                  <Fact label="Run">
                    <Link href={`/runs/${run.id}`} className="inline-flex text-link hover:underline">
                      <StatusBadge kind="run" status={run.status} />
                    </Link>
                  </Fact>
                  <Fact label="Format">{FORMAT_LABEL[d.format]}</Fact>
                  {d.recordCount !== null ? (
                    <Fact label="Records">
                      <span className="metric">{d.recordCount}</span>
                    </Fact>
                  ) : null}
                  <Fact label="Handed in">{formatDateTime(d.createdAt)}</Fact>
                  {d.reviewedAt ? <Fact label="Reviewed">{formatDateTime(d.reviewedAt)}</Fact> : null}
                  <Fact label="Id">
                    <span className="inline-flex items-center gap-1 font-mono text-caption">
                      {d.id.slice(0, 10)}…
                      <CopyButton value={d.id} />
                    </span>
                  </Fact>
                </dl>
              </CardContent>
            </Card>
          </div>
        </aside>
      </div>

      {/* Room for the mobile review bar. */}
      <div className="h-16 lg:hidden" aria-hidden="true" />
    </>
  );
}
