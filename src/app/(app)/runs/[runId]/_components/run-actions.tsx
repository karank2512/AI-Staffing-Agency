"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Loader2, RotateCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { cancelRunAction, retryRunAction } from "../actions";
import { useRunLive } from "./run-live";

export interface RunActionsProps {
  runId: string;
  workerId: string;
  workerName: string;
  /** The first deliverable, when there is one — becomes the primary button on a finished run. */
  deliverable: { id: string; title: string } | null;
}

/** Header buttons: Cancel while the run can still be stopped, Retry once it failed or was cancelled. */
export function RunActions({ runId, workerId, workerName, deliverable }: RunActionsProps) {
  const { live, refresh } = useRunLive();
  const router = useRouter();
  const [retrying, startRetry] = useTransition();
  const status = live.run.status;

  const canCancel = status === "QUEUED" || status === "RUNNING" || status === "WAITING_FOR_APPROVAL";
  const canRetry = status === "FAILED" || status === "CANCELLED";

  function retry() {
    startRetry(async () => {
      const r = await retryRunAction(runId, workerId);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`${workerName} is giving it another go`);
      router.push(r.data.redirectTo);
    });
  }

  return (
    <>
      {canCancel ? (
        <ConfirmDialog
          trigger={
            <Button variant="outline">
              <XCircle aria-hidden="true" /> Cancel run
            </Button>
          }
          title={`Cancel ${workerName}’s run?`}
          description="Any pending approval request is withdrawn and the work done so far is kept for reference. You can start a new run at any time."
          confirmLabel="Cancel run"
          destructive
          onConfirm={async () => {
            const r = await cancelRunAction(runId, workerId);
            if (!r.ok) throw new Error(r.error);
            toast.success(`${workerName}’s run was cancelled`);
            refresh();
          }}
        />
      ) : null}
      {canRetry ? (
        <Button onClick={retry} disabled={retrying}>
          {retrying ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RotateCw aria-hidden="true" />}
          Retry run
        </Button>
      ) : null}
      {deliverable ? (
        <Button asChild variant={canRetry ? "outline" : "default"}>
          <Link href={`/deliverables/${deliverable.id}`}>
            <FileText aria-hidden="true" /> View deliverable
          </Link>
        </Button>
      ) : null}
    </>
  );
}
