import type { Metadata } from "next";
import Link from "next/link";
import { Activity, FileCheck, Plus, Sparkles, Users, Wallet, Zap } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Section } from "@/components/section";
import { SimulatedBadge } from "@/components/simulated-badge";
import { StatCard, type StatTrend } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatUsd, pluralize } from "@/lib/format";
import { requireSession } from "@/server/auth";
import { getWorkforce, type WorkforceStats } from "@/server/queries/workforce";
import { ActivityRow } from "@/app/(app)/activity/_components/activity-row";
import { AttentionStrip } from "./_components/attention-strip";
import { WorkerCard } from "./_components/worker-card";

export const metadata: Metadata = { title: "Workforce" };

/** Month-over-month movement for the spend tile. Up is bad news here, so the tone is inverted. */
function spendTrend(stats: WorkforceStats): StatTrend {
  const { spendThisMonthUsd: now, spendLastMonthUsd: prev, spendByDay } = stats;
  const values = spendByDay.length > 1 ? spendByDay : undefined;
  if (prev <= 0 || now <= 0) return { values, label: prev <= 0 && now > 0 ? "first month of spend" : undefined };
  const change = (now - prev) / prev;
  if (Math.abs(change) < 0.005) return { direction: "flat", label: "same as last month", tone: "neutral", values };
  const pct = `${change > 0 ? "+" : ""}${Math.round(change * 100)}% vs last month`;
  return { direction: change > 0 ? "up" : "down", label: pct, tone: change > 0 ? "negative" : "positive", values };
}

export default async function WorkforcePage() {
  const s = await requireSession();
  const data = await getWorkforce(s.organizationId);
  const { stats, workers, attention, recentActivity } = data;
  const freshOrg = workers.length === 0 && stats.retiredWorkers === 0;

  const hireButton = (
    <Button asChild>
      <Link href="/hire">
        <Plus aria-hidden="true" /> Hire a worker
      </Link>
    </Button>
  );

  if (freshOrg) {
    return (
      <>
        <PageHeader title="Workforce" description="Your AI workers and how they're doing." actions={hireButton} />
        <EmptyState
          icon={Sparkles}
          title="Hire your first AI worker"
          description="Describe a job in plain English — a weekly market report, a feedback digest, a lead list — and we'll scope it, design a worker for it and put them to work."
          action={hireButton}
          className="py-20"
        />
        {recentActivity.length > 0 ? (
          <div className="mt-8">
            <Section title="Recent activity">
              <Card>
                <CardContent className="divide-y">
                  {recentActivity.map((item) => (
                    <ActivityRow key={item.id} item={item} dense />
                  ))}
                </CardContent>
              </Card>
            </Section>
          </div>
        ) : null}
      </>
    );
  }

  const idleWorkers = [stats.pausedWorkers > 0 ? pluralize(stats.pausedWorkers, "paused") : null, stats.retiredWorkers > 0 ? pluralize(stats.retiredWorkers, "retired") : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <PageHeader title="Workforce" description="Your AI workers and how they're doing." actions={hireButton} />

      <div className="space-y-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Active workers" value={stats.activeWorkers} icon={Users} hint={idleWorkers || "Everyone is on the job"} />
          <StatCard
            label="Runs today"
            value={stats.runsToday}
            icon={Zap}
            hint={
              stats.runsInFlight > 0 ? (
                <span className="inline-flex items-center gap-1.5 text-sky-700">
                  <span className="relative flex size-1.5" aria-hidden="true">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-sky-500 opacity-75" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-sky-500" />
                  </span>
                  {pluralize(stats.runsInFlight, "run")} in flight
                </span>
              ) : (
                "Nothing running right now"
              )
            }
          />
          <StatCard
            label="Awaiting your review"
            value={stats.deliverablesAwaitingReview}
            icon={FileCheck}
            hint={stats.deliverablesTotal > 0 ? `of ${pluralize(stats.deliverablesTotal, "deliverable")} so far` : "No deliverables yet"}
          />
          <StatCard
            label="Spend this month"
            value={formatUsd(stats.spendThisMonthUsd)}
            icon={Wallet}
            trend={spendTrend(stats)}
            hint={
              stats.spendSimulated ? (
                <span className="inline-flex items-center gap-1.5">
                  <SimulatedBadge /> priced, not billed
                </span>
              ) : (
                <Link href="/usage" className="hover:text-foreground hover:underline">
                  See usage
                </Link>
              )
            }
          />
        </div>

        {attention.length > 0 ? (
          <Section
            title="Needs your attention"
            description={`${pluralize(attention.length, "thing")} only you can unblock.`}
            actions={
              attention.some((a) => a.kind === "approval") ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href="/approvals">All approvals</Link>
                </Button>
              ) : undefined
            }
          >
            <AttentionStrip items={attention} />
          </Section>
        ) : null}

        <Section
          title="Workers"
          description={`${pluralize(workers.length, "worker")} on the roster — those needing attention first.`}
          actions={data.simulated ? <SimulatedBadge /> : undefined}
        >
          {workers.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No active workers"
              description="Everyone on the roster has been retired. Hire a new worker to pick the work back up."
              action={
                <Button variant="outline" asChild>
                  <Link href="/hire">Hire a worker</Link>
                </Button>
              }
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {workers.map((worker) => (
                <WorkerCard key={worker.id} worker={worker} />
              ))}
            </div>
          )}
        </Section>

        <Section
          title="Recent activity"
          description="The latest from your workers and your team."
          actions={
            <Button variant="outline" size="sm" asChild>
              <Link href="/activity">View all</Link>
            </Button>
          }
        >
          {recentActivity.length === 0 ? (
            <EmptyState icon={Activity} title="Quiet so far" description="Runs, deliverables and decisions will show up here as they happen." />
          ) : (
            <Card>
              <CardContent className="divide-y">
                {recentActivity.map((item) => (
                  <ActivityRow key={item.id} item={item} dense />
                ))}
              </CardContent>
            </Card>
          )}
        </Section>
      </div>

      <AutoRefresh active={data.hasRunsInFlight} />
    </>
  );
}
