import { Bot, FileText, FlaskConical, PiggyBank, Receipt, Wallet, Wrench } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Section } from "@/components/section";
import { SimulatedBadge } from "@/components/simulated-badge";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber, formatPercent, formatUsd, formatUsdPrecise, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getWorkerCost } from "@/server/queries/worker-profile";
import { CostChart } from "./cost-chart";
import type { WorkerTabProps } from "./types";

export default async function CostTab({ session, workerId, workerName }: WorkerTabProps) {
  const cost = await getWorkerCost(session.organizationId, workerId);
  const hasSpend = cost.totalCostUsd > 0;
  const estimate = cost.estimatedPerRunUsd;
  const actual = cost.avgCostPerRunUsd;
  const delta = estimate !== null && actual !== null && estimate > 0 ? (actual - estimate) / estimate : null;
  const modelShare = cost.totalCostUsd > 0 ? cost.modelCostUsd / (cost.modelCostUsd + cost.toolCostUsd || 1) : null;
  const simulatedNote = cost.simulated || (cost.simulatedShare !== null && cost.simulatedShare > 0);

  return (
    <>
      {simulatedNote ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <FlaskConical className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
          <p>
            <span className="font-medium">These numbers are what {workerName} would cost with live providers.</span>{" "}
            {cost.simulatedShare === 1 || cost.simulated
              ? "Everything ran in Simulated mode, priced at each tier's reference model — nothing was actually spent."
              : `${formatPercent(cost.simulatedShare)} of this spend came from simulated calls priced at reference rates.`}
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={`Spend, last ${cost.days} days`}
          value={formatUsd(cost.totalCostUsd)}
          hint={cost.runs > 0 ? `across ${pluralize(cost.runs, "run")}` : "No runs in this window"}
          icon={Wallet}
          trend={cost.byDay.length > 1 ? { values: cost.byDay.map((d) => d.costUsd), tone: "neutral" } : undefined}
        />
        <StatCard label="Average per run" value={formatUsdPrecise(actual)} hint="Model calls + tool fees per run" icon={Receipt} />
        <StatCard label="Per deliverable" value={formatUsdPrecise(cost.costPerDeliverableUsd)} hint="Spend ÷ deliverables produced" icon={FileText} />
        <StatCard
          label="Estimate vs actual"
          value={formatUsdPrecise(actual)}
          hint={estimate !== null ? `Blueprint estimate ${formatUsdPrecise(estimate)} per run` : "No estimate on file"}
          icon={PiggyBank}
          trend={
            delta === null
              ? undefined
              : {
                  direction: delta > 0.1 ? "up" : delta < -0.1 ? "down" : "flat",
                  tone: delta > 0.1 ? "negative" : delta < -0.1 ? "positive" : "neutral",
                  label: delta > 0.1 ? `${formatPercent(delta)} over estimate` : delta < -0.1 ? `${formatPercent(-delta)} under estimate` : "On estimate",
                }
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Daily spend</CardTitle>
            <CardDescription>What {workerName} cost each day over the last {cost.days} days.</CardDescription>
          </CardHeader>
          <CardContent>
            {hasSpend ? (
              <CostChart byDay={cost.byDay} />
            ) : (
              <EmptyState icon={Wallet} title="No spend yet" description={`${workerName} hasn't used any models or tools in this window.`} className="py-10" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Where the money goes</CardTitle>
            <CardDescription>Model thinking vs tool fees.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {modelShare === null ? (
              <p className="text-sm text-muted-foreground">Nothing to break down yet.</p>
            ) : (
              <>
                <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div className="h-full rounded-l-full bg-chart-1" style={{ width: `${Math.round(modelShare * 100)}%` }} />
                  <div className="h-full flex-1 rounded-r-full bg-chart-2" />
                </div>
                <dl className="space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="flex items-center gap-2 text-muted-foreground">
                      <span className="size-2.5 rounded-full bg-chart-1" aria-hidden="true" />
                      <Bot className="size-3.5" aria-hidden="true" />
                      Models
                    </dt>
                    <dd className="metric font-medium">
                      {formatUsd(cost.modelCostUsd)} <span className="text-xs text-muted-foreground">({formatPercent(modelShare)})</span>
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="flex items-center gap-2 text-muted-foreground">
                      <span className="size-2.5 rounded-full bg-chart-2" aria-hidden="true" />
                      <Wrench className="size-3.5" aria-hidden="true" />
                      Tools
                    </dt>
                    <dd className="metric font-medium">
                      {formatUsd(cost.toolCostUsd)} <span className="text-xs text-muted-foreground">({formatPercent(1 - modelShare)})</span>
                    </dd>
                  </div>
                </dl>
                <p className="text-xs text-pretty text-muted-foreground">
                  {modelShare >= 0.8
                    ? `Almost all of ${workerName}'s cost is model time. Moving a step to a faster tier, or replacing an agent step with a deterministic one, is where savings come from.`
                    : modelShare >= 0.5
                      ? `Model time is the bigger half. Tool fees are per call, so fewer searches per run also add up.`
                      : `Tool fees dominate — ${workerName} makes many external calls per run. Tightening the per-run call limit is the quickest lever.`}
                </p>
              </>
            )}
            {cost.estimatedMonthlyUsd !== null ? (
              <p className="border-t pt-3 text-xs text-muted-foreground">
                Planned monthly budget from the blueprint: <span className="metric font-medium text-foreground">{formatUsd(cost.estimatedMonthlyUsd)}</span>
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="By version" description="Did a change make runs cheaper or dearer?">
          <Card className="py-0">
            {cost.byVersion.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">No runs in this window.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Version</TableHead>
                    <TableHead className="text-right">Runs</TableHead>
                    <TableHead className="text-right">Avg per run</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cost.byVersion.map((v) => (
                    <TableRow key={v.workerVersionId}>
                      <TableCell className="font-medium">v{v.version}</TableCell>
                      <TableCell className="metric text-right">{formatNumber(v.runs, 0)}</TableCell>
                      <TableCell className="metric text-right">{formatUsdPrecise(v.avgCostPerRunUsd)}</TableCell>
                      <TableCell className="metric text-right font-medium">{formatUsd(v.totalCostUsd)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </Section>

        <Section title="By model and tool" description="Every resource that billed against this worker.">
          <Card className="py-0">
            {cost.byResource.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">No usage recorded in this window.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Resource</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cost.byResource.map((r) => (
                    <TableRow key={`${r.kind}:${r.resource}`}>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <Badge variant="outline" className={cn("gap-1", r.kind === "MODEL" ? "text-chart-1" : "text-chart-2")}>
                            {r.kind === "MODEL" ? <Bot /> : <Wrench />}
                            {r.kind === "MODEL" ? "Model" : "Tool"}
                          </Badge>
                          <span className="font-medium">{r.label}</span>
                          {r.label !== r.resource ? <span className="font-mono text-xs text-muted-foreground">{r.resource}</span> : null}
                          {cost.simulated && r.kind === "MODEL" ? <SimulatedBadge /> : null}
                        </span>
                      </TableCell>
                      <TableCell className="metric text-right">{formatNumber(r.calls, 0)}</TableCell>
                      <TableCell className="metric text-right font-medium">{formatUsdPrecise(r.costUsd)}</TableCell>
                      <TableCell className="metric text-right text-muted-foreground">
                        {cost.totalCostUsd > 0 ? formatPercent(r.costUsd / cost.totalCostUsd) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </Section>
      </div>
    </>
  );
}
