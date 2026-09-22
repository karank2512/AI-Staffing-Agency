"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { cancelRunAction, retryRunAction } from "../actions";
import { useRunLive } from "./run-live";

export interface RunActionsProps {
  runId: string;
  workerId: string;
  workerName: string;
  /** The first deliverable, when there is one — becomes the primary action on a finished run. */
  deliverable: { id: string; title: string } | null;
  /** `workers.run`: cancelling and retrying are the same permission the runtime checks. */
  canRun?: boolean;
}

/** Shared state for the desktop header cluster and the mobile bottom bar. */
function useRunActions({ runId, workerId, workerName, canRun = true }: RunActionsProps) {
  const { live, refresh } = useRunLive();
  const router = useRouter();
  const [retrying, startRetry] = useTransition();
  const status = live.run.status;

  return {
    retrying,
    canCancel: canRun && (status === "QUEUED" || status === "RUNNING" || status === "WAITING_FOR_APPROVAL"),
    canRetry: canRun && (status === "FAILED" || status === "CANCELLED"),
    retry() {
      startRetry(async () => {
        const r = await retryRunAction(runId, workerId);
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        toast.success(`${workerName} is giving it another go`);
        router.push(r.data.redirectTo);
      });
    },
    async cancel() {
      const r = await cancelRunAction(runId, workerId);
      if (!r.ok) throw new Error(r.error);
      toast.success(`${workerName}’s run was cancelled`);
      refresh();
    },
  };
}

/** Header controls (desktop): one primary at most — read the deliverable, or try the run again. */
export function RunActions(props: RunActionsProps) {
  const { workerName, deliverable } = props;
  const { canCancel, canRetry, retrying, retry, cancel } = useRunActions(props);

  return (
    <div className="hidden items-center gap-2.5 sm:flex">
      {canCancel ? (
        <ConfirmDialog
          trigger={<Button variant="secondary">Cancel run</Button>}
          title={`Cancel ${workerName}’s run?`}
          description="Any pending approval request is withdrawn and the work done so far is kept for reference. You can start a new run at any time."
          confirmLabel="Cancel run"
          destructive
          onConfirm={cancel}
        />
      ) : null}
      {canRetry ? (
        <Button onClick={retry} disabled={retrying} variant={deliverable ? "secondary" : "default"}>
          {retrying ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Try again
        </Button>
      ) : null}
      {deliverable ? (
        <Button asChild>
          <Link href={`/deliverables/${deliverable.id}`}>Read the deliverable</Link>
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The same actions on a phone: a frosted bar pinned to the bottom of the viewport with one full-width pill,
 * so the header stays type-only. Renders nothing when there is nothing to do.
 */
export function RunStickyActions(props: RunActionsProps) {
  const { workerName, deliverable } = props;
  const { canCancel, canRetry, retrying, retry, cancel } = useRunActions(props);
  if (!canCancel && !canRetry && !deliverable) return null;

  return (
    <div className="material-thick fixed inset-x-0 bottom-0 z-30 shadow-bar pb-[env(safe-area-inset-bottom)] sm:hidden">
      <div className={cn("flex items-center gap-3 px-4 py-3", "[&_[data-slot=button]]:h-11 [&_[data-slot=button]]:flex-1")}>
        {canCancel ? (
          <ConfirmDialog
            trigger={<Button variant="secondary">Cancel run</Button>}
            title={`Cancel ${workerName}’s run?`}
            description="Any pending approval request is withdrawn and the work done so far is kept for reference. You can start a new run at any time."
            confirmLabel="Cancel run"
            destructive
            onConfirm={cancel}
          />
        ) : null}
        {canRetry ? (
          <Button onClick={retry} disabled={retrying} variant={deliverable ? "secondary" : "default"}>
            {retrying ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Try again
          </Button>
        ) : null}
        {deliverable ? (
          <Button asChild>
            <Link href={`/deliverables/${deliverable.id}`}>Read the deliverable</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
