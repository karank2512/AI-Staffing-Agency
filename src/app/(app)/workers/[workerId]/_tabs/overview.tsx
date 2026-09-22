import Link from "next/link";
import {
  ArrowDownWideNarrow,
  ArrowRight,
  Bot,
  CheckCircle2,
  Circle,
  CopyMinus,
  FileSpreadsheet,
  FileText,
  Filter,
  Gauge,
  Inbox,
  MinusCircle,
  ShieldCheck,
  Sigma,
  Workflow,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { RelativeTime } from "@/components/relative-time";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDuration, formatNumber, formatPercent, formatUsd, formatUsdPrecise, pluralize } from "@/lib/format";
import { TONE_CLASSES } from "@/lib/status";
import { cn } from "@/lib/utils";
import { toDbDeliverableFormat } from "@/server/domain";
import { getWorkerOverview, type PipelineStep } from "@/server/queries/worker-profile";
import { formatKpiValue, kpiVerdict } from "../_components/kpi-format";
import { formatLabel, operationLabel, RECOMMENDATION_META } from "../_components/labels";
import { RunsTable } from "../_components/runs-table";
import { TierChip } from "../_components/tier-chip";
import type { WorkerTabProps } from "./types";

const OPERATION_ICONS: Record<string, LucideIcon> = {
  validate_records: ShieldCheck,
  dedupe: CopyMinus,
  rank: ArrowDownWideNarrow,
  filter: Filter,
  compute_stats: Sigma,
  to_csv: FileSpreadsheet,
  compile_report: FileText,
};

export default async function OverviewTab({ session, workerId, workerName }: WorkerTabProps) {
  const data = await getWorkerOverview(session.organizationId, workerId);
  const review = data.latestReview;
  const href = (tab: string) => `/workers/${workerId}?tab=${tab}`;

  return (
    <>
      {review && review.recommendation !== "KEEP" ? (
        <ReviewBanner workerId={workerId} workerName={workerName} recommendation={review.recommendation} detail={review.recommendationDetail} createdAt={review.createdAt} />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>About {workerName}</CardTitle>
              {data.summary ? <CardDescription>{data.summary}</CardDescription> : null}
              {data.jobFamily ? (
                <CardAction>
                  <Badge variant="outline">{data.jobFamily.replace(/_/g, " ")}</Badge>
                </CardAction>
              ) : null}
            </CardHeader>
            <CardContent>
              {data.responsibilities.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active version — responsibilities appear once {workerName} has one.</p>
              ) : (
                <>
                  <p className="eyebrow mb-2">Responsibilities</p>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {data.responsibilities.map((r) => (
                      <li key={r} className="flex items-start gap-2 text-sm">
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-hidden="true" />
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>How {workerName} works</CardTitle>
              <CardDescription>
                Each run goes through these steps in order. Model steps think; the rest are plain code — reliable and free.
              </CardDescription>
              {data.deliverable ? (
                <CardAction>
                  <Badge variant="secondary">Produces a {formatLabel(toDbDeliverableFormat(data.deliverable.format)).toLowerCase()}</Badge>
                </CardAction>
              ) : null}
            </CardHeader>
            <CardContent>
              {data.pipeline.length === 0 ? (
                <EmptyState icon={Workflow} title="No pipeline yet" description="This worker has no active version." className="py-8" />
              ) : (
                <Pipeline steps={data.pipeline} />
              )}
            </CardContent>
          </Card>

          <Section
            title="Recent runs"
            description={`The last ${data.recentRuns.length === 1 ? "run" : `${data.recentRuns.length} runs`} of ${workerName}.`}
            actions={
              <Button variant="outline" size="sm" asChild>
                <Link href={href("activity")}>View all</Link>
              </Button>
            }
          >
            <Card className="py-0">
              <RunsTable runs={data.recentRuns} workerName={workerName} compact />
            </Card>
          </Section>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Targets</CardTitle>
              <CardDescription>What {workerName} was hired to hit, over the last {data.metrics.windowDays} days.</CardDescription>
              <CardAction>
                <Button variant="ghost" size="sm" asChild>
                  <Link href={href("performance")}>
                    Details
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {data.kpis.length === 0 ? (
                <p className="text-sm text-muted-foreground">No targets defined.</p>
              ) : (
                <ul className="divide-y">
                  {data.kpis.map((kpi) => {
                    const verdict = kpiVerdict(kpi);
                    const Icon = verdict === "met" ? CheckCircle2 : verdict === "missed" ? XCircle : MinusCircle;
                    const tone = verdict === "met" ? "text-emerald-500" : verdict === "missed" ? "text-rose-500" : "text-slate-400";
                    return (
                      <li key={kpi.kpiId} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                        <Icon className={cn("size-4 shrink-0", tone)} aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{kpi.name}</p>
                          <p className="text-xs text-muted-foreground">
                            Target {kpi.direction === "lower_is_better" ? "≤" : "≥"} {formatKpiValue(kpi.metric, kpi.target)}
                          </p>
                        </div>
                        <p className="metric text-sm font-semibold">{formatKpiValue(kpi.metric, kpi.actual)}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Latest deliverable</CardTitle>
              <CardAction>
                <Button variant="ghost" size="sm" asChild>
                  <Link href={href("deliverables")}>
                    All
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {data.latestDeliverable ? (
                <div className="space-y-2">
                  <Link href={`/deliverables/${data.latestDeliverable.id}`} className="block text-sm font-medium underline-offset-4 hover:underline">
                    {data.latestDeliverable.title}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge kind="deliverable" status={data.latestDeliverable.status} />
                    <Badge variant="outline">{formatLabel(data.latestDeliverable.format)}</Badge>
                    {data.latestDeliverable.recordCount !== null ? (
                      <span className="text-xs text-muted-foreground">{pluralize(data.latestDeliverable.recordCount, "record")}</span>
                    ) : null}
                  </div>
                  {data.latestDeliverable.summary ? (
                    <p className="line-clamp-3 text-sm text-muted-foreground">{data.latestDeliverable.summary}</p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    {workerName} delivered this <RelativeTime iso={data.latestDeliverable.createdAt} /> ·{" "}
                    <Link href={`/runs/${data.latestDeliverable.runId}`} className="text-primary underline-offset-4 hover:underline">
                      see the run
                    </Link>
                  </p>
                </div>
              ) : (
                <EmptyState icon={Inbox} title="Nothing delivered yet" description={`${workerName}'s first deliverable will show up here.`} className="py-6" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cost per run</CardTitle>
              <CardDescription>Estimate from the blueprint vs what runs actually cost.</CardDescription>
              <CardAction>
                <Button variant="ghost" size="sm" asChild>
                  <Link href={href("cost")}>
                    Details
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <CostComparison estimated={data.cost.estimatedPerRunUsd} actual={data.cost.actualAvgPerRunUsd} runs={data.metrics.runs} />
              <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Planned monthly</dt>
                  <dd className="metric font-medium">{formatUsd(data.cost.estimatedMonthlyUsd)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Spent, last {data.metrics.windowDays}d</dt>
                  <dd className="metric font-medium">{formatUsd(data.metrics.totalCostUsd)}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {data.limits || data.tools.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Tools &amp; guardrails</CardTitle>
                <CardAction>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={href("permissions")}>
                      Manage
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="space-y-4">
                {data.tools.length > 0 ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {data.tools.map((t) => (
                      <li key={t.name}>
                        <Badge variant="outline" title={t.reason}>
                          {t.label}
                          {t.requiresApproval ? <ShieldCheck className="text-amber-600" aria-label="Needs your approval" /> : null}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {data.limits ? (
                  <dl className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Max cost / run</dt>
                      <dd className="metric font-medium">{formatUsd(data.limits.maxCostPerRunUsd)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Max tool calls</dt>
                      <dd className="metric font-medium">{formatNumber(data.limits.maxToolCallsPerRun, 0)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Max duration</dt>
                      <dd className="metric font-medium">{formatDuration(data.limits.maxRunDurationSec * 1000)}</dd>
                    </div>
                  </dl>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

function ReviewBanner({
  workerId,
  workerName,
  recommendation,
  detail,
  createdAt,
}: {
  workerId: string;
  workerName: string;
  recommendation: "IMPROVE" | "REPLACE";
  detail: string;
  createdAt: string;
}) {
  const meta = RECOMMENDATION_META[recommendation];
  const tone = TONE_CLASSES[meta.tone];
  return (
    <div className={cn("flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center", tone.badge)}>
      <Gauge className="size-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          Latest performance review: {meta.headline(workerName)}
          <span className="ml-2 text-xs font-normal opacity-80">
            <RelativeTime iso={createdAt} />
          </span>
        </p>
        <p className="mt-0.5 text-sm text-pretty opacity-90">{detail}</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button variant="outline" size="sm" className="bg-white" asChild>
          <Link href={`/workers/${workerId}?tab=performance`}>Read the review</Link>
        </Button>
        {recommendation === "REPLACE" ? (
          <Button size="sm" asChild>
            <Link href={`/workers/${workerId}?tab=versions#replace`}>Propose a replacement</Link>
          </Button>
        ) : (
          <Button size="sm" asChild>
            <Link href={`/workers/${workerId}?tab=chat`}>Talk to {workerName}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}

function Pipeline({ steps }: { steps: PipelineStep[] }) {
  return (
    <ol className="relative space-y-0">
      {steps.map((step, index) => {
        const Icon = step.kind === "agent" ? Bot : (OPERATION_ICONS[step.operation ?? ""] ?? Circle);
        const isLast = index === steps.length - 1;
        return (
          <li key={step.id} className="relative flex gap-3 pb-5 last:pb-0">
            {!isLast ? <span className="absolute top-8 bottom-0 left-4 w-px bg-border" aria-hidden="true" /> : null}
            <span
              className={cn(
                "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset",
                step.kind === "agent" ? "bg-primary/10 text-primary ring-primary/20" : "bg-muted text-muted-foreground ring-foreground/10",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="text-sm font-medium">
                  <span className="mr-1.5 text-xs text-muted-foreground tabular-nums">{index + 1}.</span>
                  {step.name}
                </p>
                {step.tier ? <TierChip tier={step.tier} /> : <Badge variant="secondary">{operationLabel(step.operation)}</Badge>}
              </div>
              <p className="mt-0.5 text-sm text-pretty text-muted-foreground">{step.description}</p>
              {step.tools.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Uses</span>
                  {step.tools.map((tool) => (
                    <Badge key={tool.name} variant="outline">
                      {tool.label}
                    </Badge>
                  ))}
                </div>
              ) : null}
              <p className="mt-1.5 font-mono text-[11px] text-muted-foreground/80">
                {step.inputKeys.join(", ") || "—"} → {step.outputKey}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function CostComparison({ estimated, actual, runs }: { estimated: number | null; actual: number | null; runs: number }) {
  const max = Math.max(estimated ?? 0, actual ?? 0);
  const width = (value: number | null) => (max > 0 && value !== null ? `${Math.max(2, Math.round((value / max) * 100))}%` : "2%");
  const delta = estimated !== null && actual !== null && estimated > 0 ? (actual - estimated) / estimated : null;

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>Estimated</span>
          <span className="metric text-foreground">{formatUsdPrecise(estimated)}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-slate-400" style={{ width: width(estimated) }} />
        </div>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>Actual average{runs > 0 ? ` (${pluralize(runs, "run")})` : ""}</span>
          <span className="metric text-foreground">{formatUsdPrecise(actual)}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: width(actual) }} />
        </div>
      </div>
      {delta !== null ? (
        <p className={cn("text-xs font-medium", delta > 0.1 ? "text-rose-600" : delta < -0.1 ? "text-emerald-600" : "text-muted-foreground")}>
          {delta > 0.1 ? `${formatPercent(delta)} over estimate` : delta < -0.1 ? `${formatPercent(-delta)} under estimate` : "On budget"}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">{actual === null ? "No finished runs to compare yet." : "No estimate on file."}</p>
      )}
    </div>
  );
}
