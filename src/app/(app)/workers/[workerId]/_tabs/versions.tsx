import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { formatDate, formatPercent, formatUsd, formatUsdPrecise, pluralize } from "@/lib/format";
import { SCORE_BAND_CLASSES, scoreBand } from "@/lib/status";
import { cn } from "@/lib/utils";
import { isAppError } from "@/server/errors";
import { getWorkerVersions, type VersionListItem, type WorkerVersionsView } from "@/server/queries/worker-manage";
import { Row, RowList, RowMeta, RowTitle, Sep } from "../_components/rows";
import type { WorkerTabProps } from "./types";
import { CHANGE_REASON_LABELS, TIER_LABELS } from "./versions-labels";
import { VersionsProposeCard } from "./versions-propose-card";

/** Versions tab — the worker's history of designs, newest first, plus the Replace entry point. */
export default async function VersionsTab({ session, workerId, workerName }: WorkerTabProps) {
  let data: WorkerVersionsView;
  try {
    data = await getWorkerVersions(session.organizationId, workerId, { role: session.role });
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }

  return (
    <>
      <VersionsProposeCard
        workerId={data.worker.id}
        workerName={workerName}
        canPropose={data.canPropose && data.permissions["workers.manage"]}
        mayManage={data.permissions["workers.manage"]}
        status={data.worker.status}
        openProposal={data.openProposal}
      />

      <Section
        title="Version history"
        description={`Every design ${workerName} has worked under. A design never changes once it has run — improvements are new versions.`}
      >
        {data.versions.length === 0 ? (
          <RowList>
            <li>
              <EmptyState
                title="No versions yet"
                description={`${workerName} has no design on record. Versions appear once a worker is hired.`}
              />
            </li>
          </RowList>
        ) : (
          <RowList>
            {data.versions.map((v) => (
              <VersionRow key={v.id} version={v} />
            ))}
          </RowList>
        )}
      </Section>
    </>
  );
}

function when(v: VersionListItem): string {
  if (v.status === "PROPOSED") return `Drafted ${formatDate(v.createdAt)}`;
  if (v.status === "ACTIVE") return `Live since ${formatDate(v.activatedAt ?? v.createdAt)}`;
  if (v.status === "REPLACED") return `${formatDate(v.activatedAt ?? v.createdAt)} – ${formatDate(v.retiredAt)}`;
  return `Declined · drafted ${formatDate(v.createdAt)}`;
}

function VersionRow({ version: v }: { version: VersionListItem }) {
  const band = SCORE_BAND_CLASSES[scoreBand(v.score)];
  const tiers = [...new Set(v.tiers.map((t) => TIER_LABELS[t.tier]))].join(" + ");

  return (
    <Row href={v.href ?? undefined} className="flex-col items-start gap-4 sm:flex-row sm:items-start sm:gap-6">
      <div className="min-w-0 flex-1">
        <RowTitle className="flex flex-wrap items-center gap-x-2.5">
          <span>Version {v.version}</span>
          {v.isCurrent ? <span className="text-footnote font-semibold text-success">Current</span> : null}
          {v.status === "PROPOSED" ? <StatusBadge kind="version" status={v.status} /> : null}
        </RowTitle>
        <p className="text-callout mt-1 max-w-[70ch] text-pretty text-muted-foreground">
          {v.changeSummary ? v.changeSummary.split("\n")[0] : CHANGE_REASON_LABELS[v.changeReason]}
        </p>
        <RowMeta>
          <span>{when(v)}</span>
          <Sep />
          <span>{CHANGE_REASON_LABELS[v.changeReason]}</span>
          <Sep />
          <span>
            {pluralize(v.runCount, "run")}
            {v.successRate !== null ? ` · ${formatPercent(v.successRate)} clean` : ""}
          </span>
          <Sep />
          <span>
            {v.avgCostPerRunUsd !== null
              ? `${formatUsdPrecise(v.avgCostPerRunUsd)} a run`
              : `~${formatUsd(v.estimatedCostPerRunUsd)} a run planned`}
          </span>
          {tiers ? (
            <>
              <Sep />
              <span>{tiers} models</span>
            </>
          ) : null}
        </RowMeta>
      </div>

      <div className="flex shrink-0 items-center gap-6 sm:flex-col sm:items-end sm:gap-1">
        <span className="text-right">
          <span className={cn("metric block text-[22px] leading-7 font-semibold", v.score === null ? "text-tertiary" : "text-foreground")}>
            {v.score === null ? "—" : Math.round(v.score)}
          </span>
          <span className={cn("text-footnote", v.score === null ? "text-muted-foreground" : band.text)}>
            {v.score === null ? "Not rated" : band.label}
          </span>
        </span>
        {v.href ? (
          <span className="text-footnote font-medium text-link">
            {v.status === "PROPOSED" ? "Review and decide" : "Compare"} ›
          </span>
        ) : null}
      </div>
    </Row>
  );
}
