import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, GitCompare, History } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ScoreRing } from "@/components/score-ring";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime, formatPercent, formatRelativeTime, formatUsd, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isAppError } from "@/server/errors";
import { getWorkerVersions, type VersionListItem, type WorkerVersionsView } from "@/server/queries/worker-manage";
import type { WorkerTabProps } from "./types";
import { CHANGE_REASON_LABELS, TIER_CLASSES, TIER_LABELS } from "./versions-labels";
import { VersionsProposeCard } from "./versions-propose-card";

/** Versions tab — the worker's history of designs, newest first, plus the Replace entry point. */
export default async function VersionsTab({ session, workerId, workerName }: WorkerTabProps) {
  let data: WorkerVersionsView;
  try {
    data = await getWorkerVersions(session.organizationId, workerId);
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }

  return (
    <div className="space-y-8">
      <VersionsProposeCard workerId={data.worker.id} workerName={workerName} canPropose={data.canPropose} status={data.worker.status} openProposal={data.openProposal} />

      <Section title="Version history" description={`Every design ${workerName} has worked under. Designs never change once they have run — improvements are new versions.`}>
        {data.versions.length === 0 ? (
          <Card>
            <CardContent>
              <EmptyState icon={History} title="No versions yet" description={`${workerName} has no design on record. Versions appear once a worker is hired.`} />
            </CardContent>
          </Card>
        ) : (
          <ol className="relative space-y-4 border-l border-border pl-6">
            {data.versions.map((v) => (
              <VersionRow key={v.id} version={v} workerName={workerName} />
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}

function VersionRow({ version: v, workerName }: { version: VersionListItem; workerName: string }) {
  const dotClass = v.status === "ACTIVE" ? "bg-emerald-500 ring-emerald-100" : v.status === "PROPOSED" ? "bg-amber-500 ring-amber-100" : "bg-slate-300 ring-slate-100";
  const when =
    v.status === "PROPOSED"
      ? `Proposed ${formatRelativeTime(v.createdAt)}`
      : v.status === "ACTIVE"
        ? `Active since ${formatDateTime(v.activatedAt ?? v.createdAt)}`
        : v.status === "REPLACED"
          ? `${formatDateTime(v.activatedAt ?? v.createdAt)} → ${formatDateTime(v.retiredAt)}`
          : `Declined · proposed ${formatDateTime(v.createdAt)}`;

  return (
    <li className="relative">
      <span className={cn("absolute top-5 -left-[31px] size-2.5 rounded-full ring-4", dotClass)} aria-hidden="true" />
      <Card className={cn(v.status === "PROPOSED" && "border-amber-200", v.isCurrent && "ring-primary/20")}>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">Version {v.version}</h3>
                <StatusBadge kind="version" status={v.status} />
                <Badge variant="outline" className="text-[11px]">
                  {CHANGE_REASON_LABELS[v.changeReason]}
                </Badge>
                {v.isCurrent ? <span className="text-[11px] font-medium text-primary">Current</span> : null}
              </div>
              <p className="text-xs text-muted-foreground">{when}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {v.status === "PROPOSED" && v.href ? (
                <Button size="sm" asChild>
                  <Link href={v.href}>
                    Review &amp; decide <ArrowUpRight aria-hidden="true" />
                  </Link>
                </Button>
              ) : v.href ? (
                <Button size="sm" variant="outline" asChild>
                  <Link href={v.href}>
                    <GitCompare aria-hidden="true" /> Compare with previous
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>

          {v.changeSummary ? (
            <p className="line-clamp-3 text-sm text-pretty whitespace-pre-line text-foreground/90">{v.changeSummary}</p>
          ) : (
            <p className="text-sm text-muted-foreground italic">No change summary.</p>
          )}

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <div className="flex items-center gap-2.5">
              <ScoreRing score={v.score} size={32} />
              <div>
                <dt className="text-[11px] text-muted-foreground">Score</dt>
                <dd className="font-medium tabular-nums">{v.score === null ? "Not rated" : Math.round(v.score)}</dd>
              </div>
            </div>
            <div>
              <dt className="text-[11px] text-muted-foreground">Runs</dt>
              <dd className="font-medium tabular-nums">
                {v.runCount}
                {v.successRate !== null ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">{formatPercent(v.successRate)} succeeded</span> : null}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted-foreground">Cost per run</dt>
              <dd className="font-medium tabular-nums">
                {v.avgCostPerRunUsd !== null ? formatUsd(v.avgCostPerRunUsd) : `~${formatUsd(v.estimatedCostPerRunUsd)}`}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">{v.avgCostPerRunUsd !== null ? "actual" : "estimated"}</span>
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted-foreground">Design</dt>
              <dd className="font-medium tabular-nums">
                {pluralize(v.stepCount, "step")}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">· {pluralize(v.toolNames.length, "tool")} · {v.scheduleLabel.toLowerCase()}</span>
              </dd>
            </div>
          </dl>

          {v.tiers.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">Models</span>
              {v.tiers.map((t) => (
                <span key={t.componentId} className={cn("inline-flex h-5 items-center gap-1 rounded-full border px-2 text-[11px] font-medium", TIER_CLASSES[t.tier])}>
                  {t.name}
                  <span className="font-normal opacity-80">· {TIER_LABELS[t.tier]}</span>
                </span>
              ))}
              {v.acceptanceRate !== null ? (
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {formatPercent(v.acceptanceRate)} of {workerName}&apos;s deliverables accepted
                </span>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </li>
  );
}
