import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, Bot, ChartColumn, FlaskConical, Receipt, Wallet, Wrench } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Section } from "@/components/section";
import { SimulatedBadge } from "@/components/simulated-badge";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatNumber, formatPercent, formatTokens, formatUsd, pluralize } from "@/lib/format";
import { requireSession } from "@/server/auth";
import { getUsagePage, parseUsageRange } from "@/server/queries/usage";
import { BillingCard } from "./_components/billing-card";
import { RangePicker } from "./_components/range-picker";
import { UsageChart } from "./_components/usage-chart";
import { ModelCostTable, ToolCostTable, WorkerCostTable } from "./_components/usage-tables";

export const metadata: Metadata = { title: "Usage" };

export default async function UsagePage({ searchParams }: { searchParams: Promise<{ range?: string | string[] }> }) {
  const [s, params] = await Promise.all([requireSession(), searchParams]);
  const days = parseUsageRange(params.range);
  const usage = await getUsagePage(s.organizationId, days);
  const { totals } = usage;
  const modelShare = totals.costUsd > 0 ? totals.modelCostUsd / totals.costUsd : null;
  const topWorker = usage.byWorker.find((w) => w.workerId !== null) ?? null;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            Usage
            {usage.simulatedMode ? <SimulatedBadge /> : null}
          </span>
        }
        description={`What your workers cost between ${formatDate(usage.from)} and ${formatDate(usage.to)} — model time, tool fees and what it would bill.`}
        actions={<RangePicker active={usage.days} />}
      />

      <div className="space-y-8">
        {usage.hasUsage ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label={`Cost, last ${usage.days} days`}
                value={formatUsd(totals.costUsd)}
                hint={totals.runs > 0 ? `across ${pluralize(totals.runs, "run")}` : "Platform work only"}
                icon={Wallet}
                trend={usage.byDay.length > 1 ? { values: usage.byDay.map((d) => d.costUsd), tone: "neutral" } : undefined}
              />
              <StatCard
                label="Billable"
                value={formatUsd(totals.billableUsd)}
                hint={`Cost × ${formatNumber(usage.marginMultiplier, 2)} margin`}
                icon={Receipt}
              />
              <StatCard
                label="Tokens"
                value={
                  <span className="flex items-baseline gap-2">
                    <span className="flex items-center gap-1">
                      <ArrowDownToLine className="size-3.5 text-muted-foreground" aria-hidden="true" />
                      {formatTokens(totals.inputTokens)}
                    </span>
                    <span className="flex items-center gap-1">
                      <ArrowUpFromLine className="size-3.5 text-muted-foreground" aria-hidden="true" />
                      {formatTokens(totals.outputTokens)}
                    </span>
                  </span>
                }
                hint="In (prompts) · out (answers)"
                icon={Bot}
              />
              <StatCard
                label="Calls"
                value={
                  <span className="flex items-baseline gap-2">
                    <span>{formatNumber(totals.modelCalls, 0)}</span>
                    <span className="text-sm font-normal text-muted-foreground">model</span>
                    <span>{formatNumber(totals.toolCalls, 0)}</span>
                    <span className="text-sm font-normal text-muted-foreground">tool</span>
                  </span>
                }
                hint={
                  totals.simulatedShare === null
                    ? "No spend recorded"
                    : totals.simulatedShare >= 0.999
                      ? "All simulated — reference prices, not spend"
                      : totals.simulatedShare > 0
                        ? `${formatPercent(totals.simulatedShare)} of cost was simulated`
                        : "All live — real provider spend"
                }
                icon={FlaskConical}
              />
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Daily cost</CardTitle>
                  <CardDescription>Model calls stacked on tool fees, one bar per day. Hover for the split.</CardDescription>
                </CardHeader>
                <CardContent>
                  <UsageChart byDay={usage.byDay} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Where the money goes</CardTitle>
                  <CardDescription>Model thinking vs tool fees.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {modelShare === null ? (
                    <p className="text-sm text-muted-foreground">Calls were made, but none of them carried a cost.</p>
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
                            {formatUsd(totals.modelCostUsd)} <span className="text-xs text-muted-foreground">({formatPercent(modelShare)})</span>
                          </dd>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <dt className="flex items-center gap-2 text-muted-foreground">
                            <span className="size-2.5 rounded-full bg-chart-2" aria-hidden="true" />
                            <Wrench className="size-3.5" aria-hidden="true" />
                            Tools
                          </dt>
                          <dd className="metric font-medium">
                            {formatUsd(totals.toolCostUsd)} <span className="text-xs text-muted-foreground">({formatPercent(1 - modelShare)})</span>
                          </dd>
                        </div>
                      </dl>
                    </>
                  )}
                  {topWorker ? (
                    <p className="border-t pt-3 text-xs text-pretty text-muted-foreground">
                      {topWorker.href ? (
                        <Link href={`${topWorker.href}?tab=cost`} className="font-medium text-foreground hover:underline">
                          {topWorker.workerName}
                        </Link>
                      ) : (
                        <span className="font-medium text-foreground">{topWorker.workerName}</span>
                      )}{" "}
                      is your biggest line item at {formatUsd(topWorker.costUsd)}
                      {totals.costUsd > 0 ? ` (${formatPercent(topWorker.costUsd / totals.costUsd)} of the total)` : ""}.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </div>

            <Section title="By worker" description="Who is spending what. Click a worker to see their cost breakdown by run and version.">
              <WorkerCostTable rows={usage.byWorker} totalCostUsd={totals.costUsd} />
            </Section>

            <div className="grid gap-6 xl:grid-cols-2">
              <Section title="By model" description="Every model that answered a call, with the tokens it read and wrote.">
                <ModelCostTable rows={usage.byModel} totalCostUsd={totals.costUsd} />
              </Section>
              <Section title="By tool" description="Per-call fees for tools with a real backend; built-in tools are free.">
                <ToolCostTable rows={usage.byTool} totalCostUsd={totals.costUsd} />
              </Section>
            </div>
          </>
        ) : (
          <EmptyState
            icon={ChartColumn}
            title={`No usage in the last ${usage.days} days`}
            description="Once a worker runs, every model call and tool fee lands here with what it cost and what it would bill."
            action={
              <>
                {usage.days !== 90 ? (
                  <Button variant="outline" asChild>
                    <Link href="/usage?range=90">Look back 90 days</Link>
                  </Button>
                ) : null}
                <Button asChild>
                  <Link href="/workforce">Go to Workforce</Link>
                </Button>
              </>
            }
          />
        )}

        <BillingCard
          marginMultiplier={usage.marginMultiplier}
          costUsd={totals.costUsd}
          billableUsd={totals.billableUsd}
          simulatedMode={usage.simulatedMode}
          simulatedShare={totals.simulatedShare}
        />
      </div>

      {/* Runs in flight keep appending to the ledger; a slow refresh keeps the totals honest without flicker. */}
      <AutoRefresh active={usage.hasUsage} intervalMs={15_000} />
    </>
  );
}
