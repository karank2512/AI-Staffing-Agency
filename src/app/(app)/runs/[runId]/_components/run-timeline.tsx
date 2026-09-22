"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/format";
import { TONE_CLASSES } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { RunStepDetailView } from "@/server/queries/runs";
import type { RunLiveView } from "@/server/runtime/types";
import { ApprovalDecision } from "./approval-decision";
import { useRunLive } from "./run-live";
import { hasDetails, StepDetails } from "./step-details";
import { STEP_KIND_META, STEP_STATUS_META } from "./step-meta";

/**
 * The step-by-step story of a run. Rows come from the live poll (status, title, timing); the expandable
 * bodies come from the server-rendered detail map and fill in on the refresh that follows the last poll.
 */

type LiveStep = RunLiveView["steps"][number];

export interface RunTimelineProps {
  runId: string;
  workerId: string;
  workerName: string;
  /** Server-rendered detail per step id (model/tool calls, approval, I/O). */
  details: Record<string, RunStepDetailView>;
}

function elapsed(step: LiveStep): string | null {
  if (step.durationMs !== null) return formatDuration(step.durationMs);
  if (step.status === "RUNNING" || step.status === "WAITING") {
    const ms = Date.now() - new Date(step.startedAt).getTime();
    return ms > 0 ? formatDuration(ms) : null;
  }
  return null;
}

function StepRow({ step, detail, runId, runStatus, workerId, workerName }: { step: LiveStep; detail: RunStepDetailView | undefined; runId: string; runStatus: string; workerId: string; workerName: string }) {
  const kind = STEP_KIND_META[step.kind];
  const status = STEP_STATUS_META[step.status];
  const tone = TONE_CLASSES[status.tone];
  const needsDecision = step.kind === "APPROVAL" && step.status === "WAITING" && runStatus === "WAITING_FOR_APPROVAL";
  const expandable = hasDetails(detail);
  const [open, setOpen] = useState(needsDecision || step.kind === "ERROR" || step.status === "FAILED");
  const Icon = kind.icon;
  const time = elapsed(step);

  return (
    <li className={cn("relative flex gap-3 py-3", needsDecision && "-mx-4 rounded-lg bg-amber-50/70 px-4 ring-1 ring-amber-200 ring-inset")}>
      <div className="relative flex shrink-0 flex-col items-center">
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-full bg-background ring-1 ring-foreground/10",
            step.status === "FAILED" && "text-rose-600 ring-rose-200",
            step.status === "WAITING" && "text-amber-700 ring-amber-300",
            step.status === "RUNNING" && "text-sky-700 ring-sky-300",
            step.status === "SUCCEEDED" && "text-muted-foreground",
            (step.status === "PENDING" || step.status === "SKIPPED") && "text-muted-foreground/60",
          )}
        >
          <Icon className="size-3.5" aria-hidden="true" />
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-pretty">{step.title}</p>
            {step.detail ? <p className="mt-0.5 text-xs text-muted-foreground">{step.detail}</p> : null}
            {step.error && !open ? <p className="mt-0.5 line-clamp-2 text-xs text-rose-600">{step.error}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={cn("inline-flex items-center gap-1.5 text-xs", tone.text)}>
              <span className={cn("size-1.5 rounded-full", tone.dot, status.pulse && "animate-pulse")} aria-hidden="true" />
              {status.label}
            </span>
            <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">{time ?? ""}</span>
            {expandable ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-expanded={open}
                aria-label={open ? "Hide details" : "Show details"}
                onClick={() => setOpen((v) => !v)}
                className="text-muted-foreground"
              >
                <ChevronDown className={cn("transition-transform", open && "rotate-180")} aria-hidden="true" />
              </Button>
            ) : (
              <span className="size-6" aria-hidden="true" />
            )}
          </div>
        </div>
        {open && expandable ? (
          <div className="mt-3">
            <StepDetails step={detail} runId={runId} runStatus={runStatus} workerId={workerId} workerName={workerName} />
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function RunTimeline({ runId, workerId, workerName, details }: RunTimelineProps) {
  const { live, polling, refresh } = useRunLive();
  const { run, steps } = live;

  // A WAITING approval that appeared during polling has no server detail yet (and so no Approve button):
  // fetch it once. Other details can wait for the refresh that follows the last poll.
  const requested = useRef(new Set<string>());
  useEffect(() => {
    for (const step of steps) {
      if (step.kind === "APPROVAL" && step.status === "WAITING" && !details[step.id] && !requested.current.has(step.id)) {
        requested.current.add(step.id);
        refresh();
        break;
      }
    }
  }, [steps, details, refresh]);

  if (steps.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
        {polling ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        {run.status === "QUEUED"
          ? `${workerName} is about to start — waiting for a free slot.`
          : run.status === "CANCELLED"
            ? "This run was cancelled before any work started."
            : "No steps were recorded for this run."}
      </div>
    );
  }

  const multiAttempt = steps.some((s) => s.attempt !== steps[0]?.attempt);
  let lastAttempt: number | null = null;

  // Requests the poller knows about but no WAITING step can show yet (detail not loaded, or a step without a
  // link to its approval): surface them below the timeline so a decision is always one click away.
  const shownApprovalIds = new Set(
    steps.filter((s) => s.kind === "APPROVAL" && s.status === "WAITING").map((s) => details[s.id]?.approval?.id).filter((id): id is string => !!id),
  );
  const orphanApprovals = run.status === "WAITING_FOR_APPROVAL" ? live.pendingApprovals.filter((a) => !shownApprovalIds.has(a.id)) : [];

  return (
    <div>
      <ol className="relative divide-y">
        {steps.map((step) => {
          const divider = multiAttempt && step.attempt !== lastAttempt;
          lastAttempt = step.attempt;
          return (
            <Fragment key={step.id}>
              {divider ? (
                <li className="pt-3 pb-1">
                  <p className="eyebrow">Attempt {step.attempt}</p>
                </li>
              ) : null}
              <StepRow step={step} detail={details[step.id]} runId={runId} runStatus={run.status} workerId={workerId} workerName={workerName} />
            </Fragment>
          );
        })}
      </ol>
      {orphanApprovals.length > 0 ? (
        <div className="mt-3 space-y-3">
          {orphanApprovals.map((approval) => (
            <div key={approval.id} className="rounded-lg bg-amber-50/70 p-4 ring-1 ring-amber-200 ring-inset">
              <p className="mb-3 flex items-center gap-2 text-sm font-medium text-amber-800">
                <ShieldCheck className="size-4" aria-hidden="true" />
                {workerName} needs your go-ahead
              </p>
              <ApprovalDecision runId={runId} workerId={workerId} workerName={workerName} approval={approval} />
            </div>
          ))}
        </div>
      ) : null}
      {polling ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          {run.status === "WAITING_FOR_APPROVAL"
            ? `${workerName} is waiting for your decision.`
            : run.status === "QUEUED"
              ? `${workerName} will pick this up in a moment.`
              : live.evaluationPending
                ? "Checking the deliverable…"
                : "Live — updates as it happens."}
        </p>
      ) : null}
    </div>
  );
}
