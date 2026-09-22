"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, ChevronDown, ClipboardList, Loader2, MoreHorizontal, Pause, Play, UserMinus } from "lucide-react";
import { toast } from "sonner";
import type { WorkerStatus } from "@prisma/client";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { pauseWorkerAction, resumeWorkerAction, retireWorkerAction, runNowAction } from "../actions";
import { useGenerateReview } from "./generate-review";

export interface WorkerActionsProps {
  workerId: string;
  workerName: string;
  status: WorkerStatus;
  /** False when the worker has no current version (nothing to run). */
  hasCurrentVersion: boolean;
}

/**
 * Header controls. "Run now" (with one-off instructions) is the one primary button; Performance review, Replace,
 * Pause / Resume and Retire live in a "More" menu so five buttons never squeeze the worker's name into a sliver.
 */
export function WorkerActions({ workerId, workerName, status, hasCurrentVersion }: WorkerActionsProps) {
  const router = useRouter();
  const [runOpen, setRunOpen] = useState(false);
  const [retireOpen, setRetireOpen] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [running, startRun] = useTransition();
  const [toggling, startToggle] = useTransition();
  const { reviewing, generate: review } = useGenerateReview(workerId, workerName);

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

  const runButton = (
    <Button disabled={!canRun || running} onClick={canRun ? () => setRunOpen(true) : undefined}>
      {running ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Play aria-hidden="true" />}
      Run now
    </Button>
  );

  const busy = reviewing || toggling;

  return (
    <>
      {/* Non-modal so a menu item can open the Retire dialog without Radix leaving the page unclickable. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" aria-label={`More actions for ${workerName}`}>
            {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <MoreHorizontal aria-hidden="true" />}
            More
            <ChevronDown className="opacity-60" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuItem disabled={reviewing || !hasCurrentVersion} onSelect={review}>
            {reviewing ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ClipboardList aria-hidden="true" />}
            Performance review
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/workers/${workerId}?tab=versions#replace`}>
              <ArrowLeftRight aria-hidden="true" />
              Replace {workerName}
            </Link>
          </DropdownMenuItem>
          {!retired ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={toggling} onSelect={togglePause}>
                {toggling ? <Loader2 className="animate-spin" aria-hidden="true" /> : paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
                {paused ? "Resume" : "Pause"}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setRetireOpen(true)}>
                <UserMinus aria-hidden="true" />
                Retire…
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {!retired ? (
        <RetireDialog
          open={retireOpen}
          onOpenChange={setRetireOpen}
          workerName={workerName}
          onConfirm={async () => {
            const r = await retireWorkerAction(workerId);
            if (!r.ok) throw new Error(r.error);
            toast.success(`${workerName} has been retired`, { description: "Thanks for the work. The job is open for a new hire." });
            router.refresh();
          }}
        />
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

/**
 * Controlled twin of ConfirmDialog (which owns its trigger and so cannot be opened from a menu item). While the
 * retirement is in flight the dialog cannot be dismissed — the outcome must land.
 */
function RetireDialog({
  open,
  onOpenChange,
  workerName,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workerName: string;
  onConfirm: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);

  async function confirm() {
    if (pending) return;
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Retire {workerName}?</DialogTitle>
          <DialogDescription>
            Queued runs and pending approvals are cancelled and the schedule stops. {workerName}&apos;s history, deliverables and
            reviews are kept, and the job can be re-staffed later.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={confirm}
            className="bg-destructive text-white hover:bg-destructive/90 focus-visible:border-destructive/40 focus-visible:ring-destructive/30"
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <UserMinus aria-hidden="true" />}
            Retire worker
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
