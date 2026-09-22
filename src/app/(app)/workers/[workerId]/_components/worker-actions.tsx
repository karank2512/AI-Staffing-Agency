"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, ClipboardList, Loader2, Pause, Play, UserMinus } from "lucide-react";
import { toast } from "sonner";
import type { WorkerStatus } from "@prisma/client";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { generateReviewAction, pauseWorkerAction, resumeWorkerAction, retireWorkerAction, runNowAction } from "../actions";

export interface WorkerActionsProps {
  workerId: string;
  workerName: string;
  status: WorkerStatus;
  /** False when the worker has no current version (nothing to run). */
  hasCurrentVersion: boolean;
}

const RECOMMENDATION_COPY = {
  KEEP: (name: string) => `${name} is doing well — keep going.`,
  IMPROVE: (name: string) => `${name} could do better — see what to change.`,
  REPLACE: (name: string) => `The review recommends replacing ${name}.`,
} as const;

/** Header controls: Run now (with one-off instructions), Pause / Resume, Performance review, Replace, Retire. */
export function WorkerActions({ workerId, workerName, status, hasCurrentVersion }: WorkerActionsProps) {
  const router = useRouter();
  const [runOpen, setRunOpen] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [running, startRun] = useTransition();
  const [toggling, startToggle] = useTransition();
  const [reviewing, startReview] = useTransition();

  const retired = status === "RETIRED";
  const paused = status === "PAUSED";
  const canRun = status === "ACTIVE" && hasCurrentVersion;
  const runDisabledReason = retired
    ? `${workerName} has been retired.`
    : paused
      ? `Resume ${workerName} to start a run.`
      : !hasCurrentVersion
        ? `${workerName} has no active version yet.`
        : null;

  function runNow() {
    startRun(async () => {
      const r = await runNowAction(workerId, { instructions });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setRunOpen(false);
      setInstructions("");
      toast.success(`${workerName} is on it`, {
        description: instructions.trim() ? "Your one-off instructions will be applied to this run." : "The run has been queued and will start shortly.",
        action: { label: "Watch live", onClick: () => router.push(`/runs/${r.data.runId}`) },
      });
      router.refresh();
    });
  }

  function togglePause() {
    startToggle(async () => {
      const r = paused ? await resumeWorkerAction(workerId) : await pauseWorkerAction(workerId);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(paused ? `${workerName} is back at work` : `${workerName} is paused`, {
        description: paused ? "Scheduled runs will resume." : "Queued runs were cancelled. Resume any time.",
      });
      router.refresh();
    });
  }

  function review() {
    startReview(async () => {
      const r = await generateReviewAction(workerId);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Performance review ready — ${Math.round(r.data.overallScore)}/100`, {
        description: RECOMMENDATION_COPY[r.data.recommendation](workerName),
      });
      router.push(`/workers/${workerId}?tab=performance`);
      router.refresh();
    });
  }

  const runButton = (
    <Button disabled={!canRun || running} onClick={canRun ? () => setRunOpen(true) : undefined}>
      {running ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Play aria-hidden="true" />}
      Run now
    </Button>
  );

  return (
    <>
      {!retired ? (
        <ConfirmDialog
          trigger={
            <Button variant="destructive">
              <UserMinus aria-hidden="true" />
              Retire
            </Button>
          }
          title={`Retire ${workerName}?`}
          description={
            <>
              Queued runs and pending approvals are cancelled and the schedule stops. {workerName}&apos;s history, deliverables and
              reviews are kept, and the job can be re-staffed later.
            </>
          }
          confirmLabel="Retire worker"
          destructive
          onConfirm={async () => {
            const r = await retireWorkerAction(workerId);
            if (!r.ok) throw new Error(r.error);
            toast.success(`${workerName} has been retired`, { description: "Thanks for the work. The job is open for a new hire." });
            router.refresh();
          }}
        />
      ) : null}

      <Button variant="outline" asChild>
        <Link href={`/workers/${workerId}?tab=versions#replace`}>
          <ArrowLeftRight aria-hidden="true" />
          Replace
        </Link>
      </Button>

      <Button variant="outline" disabled={reviewing || !hasCurrentVersion} onClick={review}>
        {reviewing ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ClipboardList aria-hidden="true" />}
        Performance review
      </Button>

      {!retired ? (
        <Button variant="outline" disabled={toggling} onClick={togglePause}>
          {toggling ? <Loader2 className="animate-spin" aria-hidden="true" /> : paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
          {paused ? "Resume" : "Pause"}
        </Button>
      ) : null}

      <Dialog open={runOpen} onOpenChange={(next) => (running ? undefined : setRunOpen(next))}>
        {runDisabledReason ? (
          <Tooltip>
            {/* A disabled button swallows pointer events, so the tooltip listens on a wrapper. */}
            <TooltipTrigger asChild>
              <span tabIndex={0} className="inline-flex">
                {runButton}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">{runDisabledReason}</TooltipContent>
          </Tooltip>
        ) : (
          <DialogTrigger asChild>{runButton}</DialogTrigger>
        )}
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Ask {workerName} to run now</DialogTitle>
            <DialogDescription>
              {workerName} will start a fresh run right away, on top of the regular schedule. Add one-off instructions if this run
              should be different.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="run-now-instructions">One-off instructions (optional)</Label>
            <Textarea
              id="run-now-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={`e.g. Focus on seed-stage rounds only, and keep it to the top 5.`}
              rows={4}
              maxLength={4_000}
              disabled={running}
            />
            <p className="text-xs text-muted-foreground">
              One instruction per line. They apply to this run only — to change how {workerName} works permanently, use{" "}
              <Link href={`/workers/${workerId}?tab=chat`} className="text-primary underline-offset-4 hover:underline">
                Talk to worker
              </Link>
              .
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={running} onClick={() => setRunOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={running} onClick={runNow}>
              {running ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Play aria-hidden="true" />}
              Start run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
