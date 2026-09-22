import type { ReactNode } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { RelativeTime } from "@/components/relative-time";
import { ScoreMetric } from "@/components/score-ring";
import { StatusBadge } from "@/components/status-badge";
import { WorkerAvatar } from "@/components/worker-avatar";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { WorkerHeaderView } from "@/server/queries/worker-profile";
import { WorkerActions } from "./worker-actions";

/**
 * The profile header: one dominant name, one status, a calm score and a single primary action. Everything else
 * (facts, callouts) is demoted to a quiet 13px line so the eye lands on the person, not on chrome.
 */
export function WorkerHeader({
  worker,
  floatingMobileActions = true,
}: {
  worker: WorkerHeaderView;
  /** The chat tab owns the bottom of a phone screen, so its actions stay in the header instead. */
  floatingMobileActions?: boolean;
}) {
  const inFlight = worker.inFlightRun;
  const waiting = inFlight?.status === "WAITING_FOR_APPROVAL";

  return (
    <>
      <PageHeader
        className="mb-5"
        backHref="/workforce"
        backLabel="Workforce"
        title={
          <span className="flex min-w-0 items-center gap-4 sm:gap-5">
            <WorkerAvatar name={worker.name} color={worker.avatarColor} size="xl" className="max-sm:size-14" />
            <span className="text-headline min-w-0 truncate">{worker.name}</span>
          </span>
        }
        description={
          <>
            <span className="block truncate">{worker.title}</span>
            <Link
              href={`/jobs/${worker.job.id}`}
              className="mt-1 block w-fit max-w-full truncate text-[15px] text-link hover:underline"
            >
              Hired for {worker.job.title} ›
            </Link>
          </>
        }
        actions={
          <div className="flex items-center gap-7 max-sm:mt-1">
            <ScoreMetric score={worker.score} />
            <WorkerActions
              workerId={worker.id}
              workerName={worker.name}
              status={worker.status}
              hasCurrentVersion={worker.currentVersion !== null}
              permissions={worker.permissions}
              floatOnMobile={floatingMobileActions}
            />
          </div>
        }
      />

      {/* One status for the worker, then the facts a manager glances at — all on one quiet line. */}
      <p className="text-footnote mb-6 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-muted-foreground">
        {inFlight ? (
          <>
            <StatusBadge kind="run" status={inFlight.status} />
            <Link href={`/runs/${inFlight.id}`} className="text-link hover:underline">
              {waiting ? "See what it needs ›" : "Watch live ›"}
            </Link>
          </>
        ) : (
          <StatusBadge kind="worker" status={worker.status} />
        )}
        <Dot />
        <span title={formatDateTime(worker.hiredAt)}>Hired {formatDate(worker.hiredAt)}</span>
        <Dot />
        <span>{worker.schedule.description}</span>
        <Dot />
        <span>
          {worker.status === "RETIRED" ? (
            `Retired ${formatDate(worker.retiredAt)}`
          ) : worker.status === "PAUSED" ? (
            "Paused — no runs scheduled"
          ) : worker.schedule.nextRunAt ? (
            <>
              Next run <RelativeTime iso={worker.schedule.nextRunAt} />
            </>
          ) : (
            "Runs when you ask"
          )}
        </span>
        {worker.currentVersion ? (
          <>
            <Dot />
            <span className="metric">Version {worker.currentVersion.version}</span>
          </>
        ) : null}
      </p>

      <div className="mb-8 space-y-3 empty:mb-0">
        {waiting ? (
          <Callout
            tone="warning"
            text={`${worker.name} is waiting on your go-ahead${
              worker.pendingApprovals > 1 ? ` for ${worker.pendingApprovals} actions` : ""
            } before this run can continue.`}
            href="/approvals"
            linkLabel="Review the request"
          />
        ) : worker.health === "NEEDS_ATTENTION" && worker.healthReason ? (
          <Callout
            tone="warning"
            text={`${worker.name} needs attention. ${worker.healthReason.replace(/\.?$/, ".")}`}
            href={`/workers/${worker.id}?tab=performance`}
            linkLabel="See performance"
          />
        ) : null}

        {worker.openProposal ? (
          <Callout
            tone="neutral"
            text={
              worker.openProposal.changeReason === "REPLACEMENT"
                ? `A replacement for ${worker.name} is drafted as version ${worker.openProposal.version}, and is not live until you decide.`
                : `A change to how ${worker.name} works is drafted as version ${worker.openProposal.version}, and is not live until you decide.`
            }
            href={`/workers/${worker.id}/replace/${worker.openProposal.versionId}`}
            linkLabel="Compare and decide"
          />
        ) : null}
      </div>
    </>
  );
}

function Dot() {
  return (
    <span aria-hidden="true" className="text-tertiary">
      ·
    </span>
  );
}

/** The one soft-tinted panel on the page — used only when something is actually waiting on a person. */
function Callout({
  tone,
  text,
  href,
  linkLabel,
}: {
  tone: "warning" | "neutral";
  text: ReactNode;
  href: string;
  linkLabel: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-[14px] px-4 py-3.5 text-[15px] text-pretty sm:flex-row sm:items-center sm:gap-6",
        tone === "warning" ? "bg-warning-soft text-foreground" : "bg-muted text-foreground",
      )}
    >
      <p className="min-w-0 flex-1">{text}</p>
      <Link href={href} className="shrink-0 text-[15px] font-medium text-link hover:underline">
        {linkLabel} ›
      </Link>
    </div>
  );
}
