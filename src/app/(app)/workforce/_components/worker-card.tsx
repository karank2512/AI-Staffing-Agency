import type { ReactNode } from "react";
import type { RunStatus } from "@prisma/client";
import Link from "next/link";
import { ArrowUpRight, CalendarClock, FileText, History, Wallet, type LucideIcon } from "lucide-react";
import { RelativeTime } from "@/components/relative-time";
import { ScoreRing } from "@/components/score-ring";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { WorkerAvatar } from "@/components/worker-avatar";
import { formatUsd, pluralize } from "@/lib/format";
import { getStatusMeta, statusLabel, TONE_CLASSES } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { WorkerCardView } from "@/server/queries/workforce";
import { RunNowButton } from "./run-now-button";

function runNowBlocker(worker: WorkerCardView): string | undefined {
  if (worker.status === "PAUSED") return `${worker.name} is paused — resume from the profile to run again.`;
  if (worker.status === "RETIRED") return `${worker.name} has been retired.`;
  if (worker.activeRun) return `${worker.name} already has a run ${statusLabel("run", worker.activeRun.status).toLowerCase()}.`;
  return undefined;
}

/**
 * One cell of the facts grid. At three cards per row (1280px) a cell is only ~120px wide, so the value wraps instead of
 * truncating, and secondary context ("Completed", "1 to review") goes on its own smaller line.
 */
function Fact({ icon: Icon, label, detail, children }: { icon: LucideIcon; label: string; detail?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Icon className="size-3" aria-hidden="true" />
        {label}
      </p>
      <p className="text-sm text-pretty break-words text-foreground tabular-nums">{children}</p>
      {detail ? <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

function RunStatusDetail({ status }: { status: RunStatus }) {
  const meta = getStatusMeta("run", status);
  return (
    <>
      <span className={cn("size-1.5 shrink-0 rounded-full", TONE_CLASSES[meta.tone].dot)} aria-hidden="true" />
      {meta.label}
    </>
  );
}

/** Roster entry: identity, health at a glance, the four facts a manager checks, and the two things they do next. */
export function WorkerCard({ worker }: { worker: WorkerCardView }) {
  const profile = `/workers/${worker.id}`;
  const blocker = runNowBlocker(worker);
  // Server-rendered, so a plain clock comparison is fine; AutoRefresh re-renders the page while runs are in flight.
  const nextRunDue = worker.nextRunAt !== null && new Date(worker.nextRunAt).getTime() <= Date.now();

  return (
    <Card className="relative">
      <CardHeader>
        <div className="flex items-start gap-3">
          <Link href={profile} className="shrink-0 rounded-full">
            <WorkerAvatar name={worker.name} color={worker.avatarColor} />
          </Link>
          <div className="min-w-0 flex-1">
            <Link href={profile} className="block truncate text-sm font-semibold text-foreground hover:underline">
              {worker.name}
            </Link>
            <p className="truncate text-xs text-muted-foreground">{worker.title}</p>
            <Link href={`/jobs/${worker.jobId}`} className="mt-0.5 block truncate text-xs text-muted-foreground hover:text-foreground hover:underline">
              {worker.jobTitle}
            </Link>
          </div>
          <ScoreRing score={worker.score} size={44} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pt-2">
          <StatusBadge kind="worker" status={worker.status} />
          {worker.health !== "UNKNOWN" || worker.score !== null ? <StatusBadge kind="health" status={worker.health} /> : null}
          {worker.activeRun ? (
            <Link href={`/runs/${worker.activeRun.id}`} className="rounded-full" title="Open the run">
              <StatusBadge kind="run" status={worker.activeRun.status} />
            </Link>
          ) : null}
        </div>
        {worker.health === "NEEDS_ATTENTION" && worker.healthReason ? (
          <p className="pt-1 text-xs text-pretty text-amber-800">{worker.healthReason}</p>
        ) : null}
      </CardHeader>

      <CardContent>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border bg-muted/40 p-3">
          <Fact icon={History} label="Last run" detail={worker.lastRun ? <RunStatusDetail status={worker.lastRun.status} /> : undefined}>
            {worker.lastRun ? (
              <Link href={`/runs/${worker.lastRun.id}`} className="hover:underline">
                <RelativeTime iso={worker.lastRun.at} />
              </Link>
            ) : worker.activeRun ? (
              <span className="text-muted-foreground">First run in progress</span>
            ) : (
              <span className="text-muted-foreground">Not yet</span>
            )}
          </Fact>
          <Fact icon={CalendarClock} label="Next run">
            {worker.nextRunAt === null ? (
              <span className="text-muted-foreground">{worker.status === "ACTIVE" ? worker.schedule : "Not scheduled"}</span>
            ) : nextRunDue ? (
              // The scheduler only queues a slot once the worker is free, so a past slot means "as soon as possible".
              <span title={worker.schedule} className="text-muted-foreground">
                {worker.activeRun ? "After the current run" : "Due now"}
              </span>
            ) : (
              <span title={worker.schedule}>
                <RelativeTime iso={worker.nextRunAt} />
              </span>
            )}
          </Fact>
          <Fact icon={Wallet} label="Cost this month">
            {formatUsd(worker.costThisMonthUsd)}
          </Fact>
          <Fact
            icon={FileText}
            label="Deliverables"
            detail={
              worker.deliverablesAwaitingReview > 0 ? (
                <span className="text-amber-700">{worker.deliverablesAwaitingReview} to review</span>
              ) : undefined
            }
          >
            {worker.deliverables === 0 ? (
              <span className="text-muted-foreground">None yet</span>
            ) : (
              pluralize(worker.deliverables, "deliverable")
            )}
          </Fact>
        </div>
      </CardContent>

      <CardFooter className="justify-between gap-2">
        <RunNowButton workerId={worker.id} workerName={worker.name} disabledReason={blocker} />
        <Button variant="ghost" size="sm" asChild>
          <Link href={profile}>
            View <ArrowUpRight aria-hidden="true" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
