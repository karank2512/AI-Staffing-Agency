import Link from "next/link";
import {
  ArrowLeftRight,
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Gauge,
  History,
  ListChecks,
  MinusCircle,
  Rows3,
  ThumbsUp,
  TrendingUp,
  Wallet,
  XCircle,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { RelativeTime } from "@/components/relative-time";
import { ScoreRing } from "@/components/score-ring";
import { Section } from "@/components/section";
import { SimulatedBadge } from "@/components/simulated-badge";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDuration, formatNumber, formatPercent, formatUsdPrecise, pluralize } from "@/lib/format";
import { SCORE_BAND_CLASSES, scoreBand, TONE_CLASSES } from "@/lib/status";
import { cn } from "@/lib/utils";
import { getWorkerPerformance, type ActiveVersionRef, type WorkerReviewRow } from "@/server/queries/worker-profile";
import { GenerateReviewButton } from "../_components/generate-review";
import { describeScore, formatKpiValue, kpiVerdict } from "../_components/kpi-format";
import { beforeChangeLabel, evaluationHint, evaluationLabel, RECOMMENDATION_META } from "../_components/labels";
import { PerformanceChart } from "./performance-chart";
import type { WorkerTabProps } from "./types";

const COMPONENT_LABELS = {
  deterministic: { label: "Automated checks", hint: "Record counts, required fields, duplicates, sections, cost limits." },
  judge: { label: "AI judge", hint: "A reviewer model scores each deliverable against the job's rubric." },
  user: { label: "Your feedback", hint: "Deliverables you accepted or rejected." },
} as const;

/** Static so Tailwind emits them (score bands → bar fills). */
const BAR_CLASSES: Record<ReturnType<typeof scoreBand>, string> = {
  good: "bg-emerald-500",
  fair: "bg-amber-500",
  poor: "bg-rose-500",
  none: "bg-slate-300",
};

export default async function PerformanceTab({ session, workerId, workerName }: WorkerTabProps) {
  const data = await getWorkerPerformance(session.organizationId, workerId);
  const { score, metrics } = data;
  const band = SCORE_BAND_CLASSES[scoreBand(score.score)];
  const active = data.activeVersion;
  // Reviews are newest first; after a replacement the old verdicts stay visible, but only as history.
  const latestCurrentId = data.reviews.find((r) => r.forCurrentVersion)?.id ?? null;
  const onlyHistory = active !== null && data.reviews.length > 0 && latestCurrentId === null;

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Score</CardTitle>
            <CardDescription>
              {score.sampleSize.runs > 0
                ? `Over the last ${pluralize(score.sampleSize.runs, "finished run")}${data.currentVersion ? ` of v${data.currentVersion}` : ""}.`
                : "Scored once the first run has been evaluated."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center gap-4">
              <ScoreRing score={score.score} size={96} />
              <div>
                <p className={cn("text-lg font-semibold", band.text)}>{band.label}</p>
                <p className="text-sm text-pretty text-muted-foreground">
                  {workerName} is {describeScore(score.score)}.
                </p>
              </div>
            </div>
            <ul className="space-y-3">
              {(["deterministic", "judge", "user"] as const).map((key) => {
                const value = score.components[key];
                const weight = score.weightsUsed[key];
                const n = score.sampleSize[key];
                const pct = value === null ? null : value * 100;
                const partBand = SCORE_BAND_CLASSES[scoreBand(pct)];
                return (
                  <li key={key} title={COMPONENT_LABELS[key].hint}>
                    <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                      <span className="font-medium text-foreground">{COMPONENT_LABELS[key].label}</span>
                      <span className="text-muted-foreground">
                        {value === null ? "No data yet" : `${pluralize(n, "sample")} · weight ${formatPercent(weight)}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn("h-full rounded-full", BAR_CLASSES[scoreBand(pct)])}
                          style={{ width: value === null ? "0%" : `${Math.max(2, Math.round(value * 100))}%` }}
                        />
                      </div>
                      <span className={cn("metric w-10 text-right text-xs font-semibold", value === null ? "text-muted-foreground" : partBand.text)}>
                        {value === null ? "—" : Math.round(value * 100)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Score per run</CardTitle>
            <CardDescription>
              Each finished run scored 0–100 in the last {metrics.windowDays} days. Above the green line is strong; below the amber line
              needs attention.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {metrics.scoreTrend.length < 2 ? (
              <EmptyState
                icon={TrendingUp}
                title="Not enough runs for a trend"
                description={`A trend appears after ${workerName} has finished at least two evaluated runs.`}
                className="py-10"
              />
            ) : (
              <PerformanceChart points={metrics.scoreTrend} workerName={workerName} />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Success rate" value={formatPercent(metrics.successRate)} hint={`${metrics.succeeded} of ${pluralize(metrics.runs, "run")}`} icon={CheckCircle2} />
        <StatCard
          label="Acceptance rate"
          value={formatPercent(metrics.acceptanceRate)}
          hint={metrics.accepted + metrics.rejected > 0 ? `${metrics.accepted} accepted · ${metrics.rejected} rejected` : "Nothing reviewed yet"}
          icon={ThumbsUp}
        />
        <StatCard label="AI judge score" value={metrics.avgJudgeScore === null ? "—" : formatNumber(metrics.avgJudgeScore * 100, 0)} hint="Average, out of 100" icon={Gauge} />
        <StatCard label="Records per run" value={formatNumber(metrics.avgRecordsPerRun, 1)} hint="Average across deliverables" icon={Rows3} />
        <StatCard label="Avg duration" value={metrics.avgDurationSec === null ? "—" : formatDuration(metrics.avgDurationSec * 1000)} hint="Active working time" icon={Clock} />
        <StatCard label="Avg cost per run" value={formatUsdPrecise(metrics.avgCostPerRunUsd)} hint={`${formatUsdPrecise(metrics.totalCostUsd)} total`} icon={Wallet} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-[15px] leading-6 font-semibold tracking-tight">Performance reviews</h2>
              <p className="text-[13px] text-muted-foreground">A written review of {workerName}&apos;s recent work with a keep / improve / replace call.</p>
            </div>
            {data.reviews.length > 0 && !onlyHistory ? (
              <GenerateReviewButton workerId={workerId} workerName={workerName} size="sm" label="New review" disabled={!active} />
            ) : null}
          </div>
          {data.reviews.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No reviews yet"
              description={`Have ${workerName}'s recent work assessed: a score, strengths, problems and a keep / improve / replace call.`}
              action={active ? <GenerateReviewButton workerId={workerId} workerName={workerName} /> : null}
            />
          ) : (
            <div className="space-y-4">
              {onlyHistory && active ? (
                <EmptyState
                  icon={History}
                  title={`No review of v${active.version} yet`}
                  description={
                    <>
                      The reviews below were written about earlier versions. {workerName} has worked as v{active.version}
                      {active.activatedAt ? ` since ${formatDate(active.activatedAt)}` : ""} — review it once it has a few runs behind it.
                    </>
                  }
                  action={<GenerateReviewButton workerId={workerId} workerName={workerName} label={`Review v${active.version}`} />}
                  className="py-8"
                />
              ) : null}
              {data.reviews.map((review) => (
                <ReviewCard
                  key={review.id}
                  review={review}
                  workerId={workerId}
                  workerName={workerName}
                  latest={review.id === latestCurrentId}
                  active={active}
                />
              ))}
            </div>
          )}
        </div>

        <Card className="self-start">
          <CardHeader>
            <CardTitle>Targets</CardTitle>
            <CardDescription>Last {metrics.windowDays} days.</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {metrics.kpis.length === 0 ? (
              <p className="px-6 text-sm text-muted-foreground">No targets defined for this worker.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Target</TableHead>
                    <TableHead className="text-right">Goal</TableHead>
                    <TableHead className="pr-6 text-right">Actual</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.kpis.map((kpi) => {
                    const verdict = kpiVerdict(kpi);
                    const Icon = verdict === "met" ? CheckCircle2 : verdict === "missed" ? XCircle : MinusCircle;
                    const tone = verdict === "met" ? "text-emerald-500" : verdict === "missed" ? "text-rose-500" : "text-slate-400";
                    return (
                      <TableRow key={kpi.kpiId}>
                        <TableCell className="pl-6">
                          <span className="flex items-center gap-2">
                            <Icon className={cn("size-4 shrink-0", tone)} aria-label={verdict} />
                            <span className="font-medium">{kpi.name}</span>
                          </span>
                        </TableCell>
                        <TableCell className="metric text-right text-muted-foreground">
                          {kpi.direction === "lower_is_better" ? "≤ " : "≥ "}
                          {formatKpiValue(kpi.metric, kpi.target)}
                        </TableCell>
                        <TableCell className={cn("metric pr-6 text-right font-semibold", verdict === "missed" ? "text-rose-600" : verdict === "met" ? "text-emerald-600" : "")}>
                          {formatKpiValue(kpi.metric, kpi.actual)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Section title="Evaluations" description={`Every check run on ${workerName}'s deliverables, newest first.`}>
        {data.evaluations.length === 0 ? (
          <EmptyState icon={ListChecks} title="No evaluations yet" description="Each finished run is checked automatically and scored by an AI judge." />
        ) : (
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Summary</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead className="w-0">
                    <span className="sr-only">Links</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.evaluations.map((e) => {
                  const pct = e.score * 100;
                  const evalBand = SCORE_BAND_CLASSES[scoreBand(pct)];
                  return (
                    <TableRow key={e.id}>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <ClipboardCheck className="size-3.5 text-muted-foreground" aria-hidden="true" />
                          <span className="font-medium" title={evaluationHint(e.type)}>
                            {evaluationLabel(e.type)}
                          </span>
                          {e.simulated ? <SimulatedBadge /> : null}
                        </span>
                      </TableCell>
                      <TableCell className={cn("metric text-right font-semibold", evalBand.text)}>{Math.round(pct)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={e.passed ? TONE_CLASSES.success.badge : TONE_CLASSES.failure.badge}>
                          {e.passed ? "Passed" : "Did not pass"}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-md">
                        <p className="line-clamp-2 text-muted-foreground" title={e.summary ?? undefined}>
                          {e.summary ?? "—"}
                        </p>
                        {e.deliverableTitle ? <p className="mt-0.5 truncate text-xs text-muted-foreground/80">{e.deliverableTitle}</p> : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        <RelativeTime iso={e.createdAt} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right text-xs">
                        {e.deliverableId ? (
                          <Link href={`/deliverables/${e.deliverableId}`} className="mr-3 text-primary underline-offset-4 hover:underline">
                            Deliverable
                          </Link>
                        ) : null}
                        {e.runId ? (
                          <Link href={`/runs/${e.runId}`} className="inline-flex items-center gap-0.5 text-primary underline-offset-4 hover:underline">
                            Run
                            <ArrowUpRight className="size-3" aria-hidden="true" />
                          </Link>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </Section>
    </>
  );
}

function ReviewCard({
  review,
  workerId,
  workerName,
  latest,
  active,
}: {
  review: WorkerReviewRow;
  workerId: string;
  workerName: string;
  latest: boolean;
  active: ActiveVersionRef | null;
}) {
  const meta = RECOMMENDATION_META[review.recommendation];
  const tone = TONE_CLASSES[meta.tone];
  const historical = !review.forCurrentVersion;
  return (
    <Card id={latest ? "latest-review" : undefined} className={cn(historical && "bg-muted/30")}>
      <CardHeader>
        <div className="flex items-start gap-4">
          <ScoreRing score={review.overallScore} size={48} />
          <div className="min-w-0 flex-1">
            <CardTitle className="flex flex-wrap items-center gap-2">
              {historical ? `Review of v${review.version} (${beforeChangeLabel(active?.changeReason)})` : meta.headline(workerName)}
              <span className={cn("inline-flex h-5.5 items-center rounded-full border px-2 text-xs font-medium", tone.badge)}>{meta.label}</span>
              {latest ? <Badge variant="secondary">Latest</Badge> : null}
            </CardTitle>
            <CardDescription>
              {formatDate(review.periodStart)} – {formatDate(review.periodEnd)} · v{review.version} · written <RelativeTime iso={review.createdAt} />
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-pretty">{review.summary}</p>
        {review.strengths.length > 0 || review.problems.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {review.strengths.length > 0 ? (
              <div>
                <p className="eyebrow mb-1.5">Strengths</p>
                <ul className="space-y-1.5">
                  {review.strengths.map((s) => (
                    <li key={s} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-hidden="true" />
                      <span className="text-pretty">{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {review.problems.length > 0 ? (
              <div>
                <p className="eyebrow mb-1.5">Problems</p>
                <ul className="space-y-1.5">
                  {review.problems.map((p) => (
                    <li key={p} className="flex items-start gap-2 text-sm">
                      <XCircle className="mt-0.5 size-4 shrink-0 text-rose-500" aria-hidden="true" />
                      <span className="text-pretty">{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
        {historical ? (
          // The call was about a version that no longer runs — keep it readable, but without a call-to-action.
          <div className="rounded-lg border border-dashed p-3 text-sm text-pretty text-muted-foreground">
            <p>
              <span className="font-semibold text-foreground">Recommendation for v{review.version}: {meta.label}.</span> {review.recommendationDetail}
            </p>
            {active ? (
              <p className="mt-1.5 text-xs">
                {workerName} has worked as v{active.version}
                {active.activatedAt ? ` since ${formatDate(active.activatedAt)}` : ""}, so this call no longer applies.
              </p>
            ) : null}
          </div>
        ) : (
          <div className={cn("flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center", tone.badge)}>
            <p className="min-w-0 flex-1 text-sm text-pretty">
              <span className="font-semibold">Recommendation: {meta.label}.</span> {review.recommendationDetail}
            </p>
            {review.recommendation === "REPLACE" ? (
              <Button size="sm" className="shrink-0" asChild>
                <Link href={`/workers/${workerId}?tab=versions#replace`}>
                  <ArrowLeftRight aria-hidden="true" />
                  Propose replacement
                </Link>
              </Button>
            ) : review.recommendation === "IMPROVE" ? (
              <Button variant="outline" size="sm" className="shrink-0 bg-white" asChild>
                <Link href={`/workers/${workerId}?tab=chat`}>Talk to {workerName}</Link>
              </Button>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
