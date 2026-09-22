import { CalendarClock, ClipboardCheck, Gauge, Target, Wallet } from "lucide-react";
import { describeCadence, type WorkerProposal } from "@/server/domain";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDuration, formatNumber, formatPercent, formatTokens, formatUsd, formatUsdPrecise } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CONFIDENCE_LABELS, MODEL_TIER_LABELS, formatKpiTarget } from "../schema";

const CONFIDENCE_CLASSES = {
  low: "border-amber-200 bg-amber-50 text-amber-800",
  medium: "border-sky-200 bg-sky-50 text-sky-700",
  high: "border-emerald-200 bg-emerald-50 text-emerald-700",
} as const;

/**
 * The bottom half of "Meet your worker": targets, cost, schedule and how performance gets judged. Everything here is
 * a plain number from the blueprint — the page never recomputes estimates.
 */
export function ProposalDetails({ proposal }: { proposal: WorkerProposal }) {
  const { blueprint } = proposal;
  const { costEstimate, evaluation, limits } = blueprint;
  const weightTotal = evaluation.weights.deterministic + evaluation.weights.judge + evaluation.weights.user || 1;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="size-4 text-muted-foreground" aria-hidden="true" />
            KPIs
          </CardTitle>
          <CardDescription>What {blueprint.persona.name} is measured on, run after run.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {blueprint.kpis.map((kpi) => (
              <li key={kpi.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{kpi.name}</p>
                  <p className="text-xs text-pretty text-muted-foreground">{kpi.description}</p>
                </div>
                <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs font-medium metric">{formatKpiTarget(kpi)}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="size-4 text-muted-foreground" aria-hidden="true" />
            Schedule and limits
          </CardTitle>
          <CardDescription>When runs happen and the guardrails on each one.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="col-span-2 rounded-lg border bg-muted/40 p-3">
              <dt className="text-xs text-muted-foreground">Cadence</dt>
              <dd className="font-medium">{describeCadence(blueprint.schedule)}</dd>
            </div>
            <div className="rounded-lg border bg-muted/40 p-3">
              <dt className="text-xs text-muted-foreground">Max cost per run</dt>
              <dd className="font-medium metric">{formatUsd(limits.maxCostPerRunUsd)}</dd>
            </div>
            <div className="rounded-lg border bg-muted/40 p-3">
              <dt className="text-xs text-muted-foreground">Max tool calls</dt>
              <dd className="font-medium metric">{formatNumber(limits.maxToolCallsPerRun, 0)}</dd>
            </div>
            <div className="rounded-lg border bg-muted/40 p-3">
              <dt className="text-xs text-muted-foreground">Max duration</dt>
              <dd className="font-medium metric">{formatDuration(limits.maxRunDurationSec * 1000)}</dd>
            </div>
            <div className="rounded-lg border bg-muted/40 p-3">
              <dt className="text-xs text-muted-foreground">Runs per month</dt>
              <dd className="font-medium metric">~{formatNumber(costEstimate.runsPerMonth, 1)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="size-4 text-muted-foreground" aria-hidden="true" />
            Cost estimate
          </CardTitle>
          <CardDescription>Model tokens plus tool fees, before your platform margin. Real spend shows up on the Cost tab after the first run.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Per run</p>
              <p className="text-xl font-semibold metric">{formatUsdPrecise(costEstimate.perRunUsd)}</p>
            </div>
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Per month</p>
              <p className="text-xl font-semibold metric">{formatUsd(costEstimate.monthlyUsd)}</p>
            </div>
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Confidence</p>
              <Badge variant="outline" className={cn("mt-1", CONFIDENCE_CLASSES[costEstimate.confidence])}>
                {CONFIDENCE_LABELS[costEstimate.confidence]}
              </Badge>
            </div>
          </div>

          {costEstimate.breakdown.length > 0 ? (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Step</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Tokens in / out</TableHead>
                    <TableHead className="text-right">Tool calls</TableHead>
                    <TableHead className="text-right">Per run</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {costEstimate.breakdown.map((item) => (
                    <TableRow key={item.componentId}>
                      <TableCell className="font-medium">{item.label}</TableCell>
                      <TableCell className="text-muted-foreground">{item.modelTier ? MODEL_TIER_LABELS[item.modelTier] : "—"}</TableCell>
                      <TableCell className="text-right metric">{formatNumber(item.estModelCalls, 0)}</TableCell>
                      <TableCell className="text-right metric">
                        {formatTokens(item.estInputTokens)} / {formatTokens(item.estOutputTokens)}
                      </TableCell>
                      <TableCell className="text-right metric">{formatNumber(item.estToolCalls, 0)}</TableCell>
                      <TableCell className="text-right metric">{formatUsdPrecise(item.costUsd)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}

          {costEstimate.assumptions.length > 0 ? (
            <div>
              <p className="eyebrow mb-1.5">Assumptions</p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {costEstimate.assumptions.map((line, i) => (
                  <li key={`${i}-${line}`} className="flex gap-2">
                    <span aria-hidden="true">·</span>
                    <span className="text-pretty">{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="size-4 text-muted-foreground" aria-hidden="true" />
            How performance is judged
          </CardTitle>
          <CardDescription>
            Every run is scored three ways — automatic checks, an AI reviewer and your own feedback — and passes at{" "}
            <span className="font-medium text-foreground metric">{formatPercent(evaluation.passThreshold)}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[auto_1fr_1fr]">
          <dl className="grid min-w-44 content-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-xs text-muted-foreground">Automatic checks</dt>
              <dd className="font-medium metric">{formatPercent(evaluation.weights.deterministic / weightTotal)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-xs text-muted-foreground">AI reviewer</dt>
              <dd className="font-medium metric">{formatPercent(evaluation.weights.judge / weightTotal)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-xs text-muted-foreground">Your feedback</dt>
              <dd className="font-medium metric">{formatPercent(evaluation.weights.user / weightTotal)}</dd>
            </div>
          </dl>
          <div>
            <p className="eyebrow mb-2 flex items-center gap-1.5">
              <Gauge className="size-3" aria-hidden="true" />
              Automatic checks
            </p>
            {evaluation.deterministicChecks.length === 0 ? (
              <p className="text-sm text-muted-foreground">None for this deliverable.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {evaluation.deterministicChecks.map((check) => (
                  <li key={check.id} className="text-pretty">
                    {check.description}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="eyebrow mb-2">Reviewer rubric</p>
            <ul className="space-y-1.5 text-sm">
              {evaluation.rubric.map((criterion) => (
                <li key={criterion.id}>
                  <span className="font-medium">{criterion.criterion}</span>
                  <span className="text-muted-foreground"> — {criterion.description}</span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
