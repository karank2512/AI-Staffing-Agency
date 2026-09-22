import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, CalendarDays, GitCommitHorizontal, Radio, ShieldAlert, Sparkles, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { RelativeTime } from "@/components/relative-time";
import { ScoreRing } from "@/components/score-ring";
import { SimulatedBadge } from "@/components/simulated-badge";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { WorkerAvatar } from "@/components/worker-avatar";
import { formatDate, formatDateTime } from "@/lib/format";
import { SCORE_BAND_CLASSES, scoreBand, statusLabel } from "@/lib/status";
import type { WorkerHeaderView } from "@/server/queries/worker-profile";
import { cn } from "@/lib/utils";
import { WorkerActions } from "./worker-actions";

/** Big avatar, name, badges, score and the facts a manager glances at before opening a tab. */
export function WorkerHeader({ worker }: { worker: WorkerHeaderView }) {
  const band = SCORE_BAND_CLASSES[scoreBand(worker.score)];
  const inFlight = worker.inFlightRun;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Workforce", href: "/workforce" }, { label: worker.name }]}
        title={
          <span className="flex items-center gap-3">
            <WorkerAvatar name={worker.name} color={worker.avatarColor} size="lg" />
            <span className="flex flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                {worker.name}
                <StatusBadge kind="worker" status={worker.status} />
                {/* The reason is one sentence from the evaluation module — surfaced as a tooltip here and in full in the banner below. */}
                <span title={worker.healthReason ?? undefined} className="inline-flex">
                  <StatusBadge kind="health" status={worker.health} />
                </span>
                {worker.simulated ? <SimulatedBadge /> : null}
              </span>
              <span className="text-sm font-normal text-muted-foreground">{worker.title}</span>
            </span>
          </span>
        }
        description={
          <>
            Hired for{" "}
            <Link href={`/jobs/${worker.job.id}`} className="font-medium text-foreground underline-offset-4 hover:underline">
              {worker.job.title}
            </Link>
            {worker.summary ? <> · {worker.summary}</> : null}
          </>
        }
        actions={
          <WorkerActions
            workerId={worker.id}
            workerName={worker.name}
            status={worker.status}
            hasCurrentVersion={worker.currentVersion !== null}
          />
        }
      />

      <div className="mb-6 space-y-3">
        {worker.health === "NEEDS_ATTENTION" && worker.healthReason ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
            <p>
              <span className="font-medium">{worker.name} needs attention.</span> {worker.healthReason.replace(/\.?$/, ".")}
            </p>
            <Button variant="outline" size="sm" className="ml-auto shrink-0 bg-white" asChild>
              <Link href={`/workers/${worker.id}?tab=performance`}>
                Review performance
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        ) : null}

        {inFlight ? <InFlightBanner name={worker.name} run={inFlight} pendingApprovals={worker.pendingApprovals} /> : null}

        {worker.openProposal ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-900">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-sky-600" aria-hidden="true" />
            <p>
              <span className="font-medium">
                {worker.openProposal.changeReason === "REPLACEMENT" ? "A replacement is ready to review." : "A proposed change is waiting for you."}
              </span>{" "}
              Version {worker.openProposal.version} has been drafted but is not live yet.
            </p>
            <Button variant="outline" size="sm" className="ml-auto shrink-0 bg-white" asChild>
              <Link href={`/workers/${worker.id}/replace/${worker.openProposal.versionId}`}>
                Review proposal
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        ) : null}

        <div className="grid gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:grid-cols-[auto_1fr] sm:items-center">
          <div className="flex items-center gap-3 sm:pr-4 sm:border-r sm:border-border">
            <ScoreRing score={worker.score} size={72} />
            <div className="min-w-0">
              <p className="eyebrow">Score</p>
              <p className={cn("text-sm font-semibold", band.text)}>{band.label}</p>
              <p className="text-xs text-muted-foreground">
                {worker.scoreUpdatedAt ? (
                  <>
                    Updated <RelativeTime iso={worker.scoreUpdatedAt} />
                  </>
                ) : (
                  "Scored after the first evaluated run"
                )}
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            <Fact icon={CalendarDays} label="Hired">
              <span title={formatDateTime(worker.hiredAt)}>{formatDate(worker.hiredAt)}</span>
              {worker.retiredAt ? <span className="block text-xs text-muted-foreground">Retired {formatDate(worker.retiredAt)}</span> : null}
            </Fact>
            <Fact icon={CalendarClock} label="Schedule">
              {worker.schedule.description}
              <span className="block text-xs text-muted-foreground">
                {worker.status !== "ACTIVE" ? (
                  `Paused while ${statusLabel("worker", worker.status).toLowerCase()}`
                ) : worker.schedule.nextRunAt ? (
                  <>
                    Next run <RelativeTime iso={worker.schedule.nextRunAt} />
                  </>
                ) : (
                  "Runs when you ask"
                )}
              </span>
            </Fact>
            <Fact icon={Radio} label="Last run">
              {worker.lastRunAt ? <RelativeTime iso={worker.lastRunAt} /> : "Not yet"}
            </Fact>
            <Fact icon={GitCommitHorizontal} label="Version">
              {worker.currentVersion ? (
                <>
                  v{worker.currentVersion.version}
                  <span className="block text-xs text-muted-foreground">
                    {worker.currentVersion.changeReason === "INITIAL_HIRE"
                      ? "Original hire"
                      : worker.currentVersion.changeReason === "REPLACEMENT"
                        ? "Replacement"
                        : "Updated"}
                    {worker.currentVersion.activatedAt ? <> · since {formatDate(worker.currentVersion.activatedAt)}</> : null}
                  </span>
                </>
              ) : (
                "No active version"
              )}
            </Fact>
          </dl>
        </div>
      </div>
    </>
  );
}

function Fact({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="mb-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </dt>
      <dd className="font-medium text-foreground">{children}</dd>
    </div>
  );
}

function InFlightBanner({
  name,
  run,
  pendingApprovals,
}: {
  name: string;
  run: NonNullable<WorkerHeaderView["inFlightRun"]>;
  pendingApprovals: number;
}) {
  const waiting = run.status === "WAITING_FOR_APPROVAL";
  const tone = waiting ? "border-amber-200 bg-amber-50 text-amber-900" : "border-sky-200 bg-sky-50 text-sky-900";
  const headline = waiting
    ? `${name} is waiting on your approval`
    : run.status === "RUNNING"
      ? `${name} is working right now`
      : `${name} is about to start a run`;
  const detail = waiting
    ? pendingApprovals > 0
      ? `${pendingApprovals === 1 ? "One action needs" : `${pendingApprovals} actions need`} your go-ahead before the run can continue.`
      : "The run is paused until someone decides on the request."
    : run.trigger === "SCHEDULED"
      ? "This is a scheduled run."
      : run.trigger === "HIRE"
        ? "First run after hiring."
        : "Started on request.";

  return (
    <div className={cn("flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm", tone)}>
      <StatusBadge kind="run" status={run.status} />
      <p className="min-w-0 flex-1">
        <span className="font-medium">{headline}.</span> <span className="opacity-80">{detail}</span>
      </p>
      {waiting ? (
        <Button variant="outline" size="sm" className="shrink-0 bg-white" asChild>
          <Link href="/approvals">Decide</Link>
        </Button>
      ) : null}
      <Button variant="outline" size="sm" className="shrink-0 bg-white" asChild>
        <Link href={`/runs/${run.id}`}>
          Watch live
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    </div>
  );
}
