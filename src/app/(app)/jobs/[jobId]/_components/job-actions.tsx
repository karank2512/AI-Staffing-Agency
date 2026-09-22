"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArrowRight, Trash2, UserPlus, UserRound } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import type { JobDetailView } from "@/server/queries/jobs";
import { closeJobAction, discardJobAction } from "../../actions";

export interface JobActionsProps {
  jobId: string;
  title: string;
  /** Decides how "discard" reads: a DRAFT job loses a draft spec, a SPEC_APPROVED one loses an approved spec. */
  status: JobDetailView["job"]["status"];
  can: JobDetailView["can"];
  /** The worker holding the seat, for the "View worker" shortcut. */
  currentWorker: { id: string; name: string } | null;
}

/** Header controls for a job. The ONE primary button is "Hire" (when the seat is open); everything else is outline. */
export function JobActions({ jobId, title, status, can, currentWorker }: JobActionsProps) {
  const router = useRouter();
  const hireHref = `/hire?jobId=${encodeURIComponent(jobId)}`;
  const isDraft = status === "DRAFT";

  return (
    <>
      {can.discard ? (
        <ConfirmDialog
          trigger={
            <Button variant="destructive">
              <Trash2 aria-hidden="true" /> {isDraft ? "Discard draft" : "Discard job"}
            </Button>
          }
          title={`Discard “${title}”?`}
          description={`The job and its ${isDraft ? "draft" : "approved"} spec are deleted. Nothing has been hired, so there is no history to keep.`}
          confirmLabel="Discard job"
          destructive
          onConfirm={async () => {
            const r = await discardJobAction(jobId);
            if (!r.ok) throw new Error(r.error);
            toast.success(isDraft ? "Draft discarded" : "Job discarded");
            router.push(r.data.redirectTo);
          }}
        />
      ) : null}

      {can.close ? (
        <ConfirmDialog
          trigger={
            <Button variant="outline">
              <Archive aria-hidden="true" /> Close job
            </Button>
          }
          title={`Close “${title}”?`}
          description="Nobody can be hired for it afterwards. Runs, deliverables and evaluations stay in your records."
          confirmLabel="Close job"
          onConfirm={async () => {
            const r = await closeJobAction(jobId);
            if (!r.ok) throw new Error(r.error);
            toast.success(`“${r.data.title}” is closed`);
            router.refresh();
          }}
        />
      ) : null}

      {currentWorker ? (
        <Button variant="outline" asChild>
          <Link href={`/workers/${currentWorker.id}`}>
            <UserRound aria-hidden="true" /> View {currentWorker.name}
          </Link>
        </Button>
      ) : null}

      {can.continueSetup ? (
        <Button asChild>
          <Link href={hireHref}>
            Continue setup <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      ) : null}

      {can.hire ? (
        <Button asChild>
          <Link href={hireHref}>
            <UserPlus aria-hidden="true" /> Hire a worker for this job
          </Link>
        </Button>
      ) : null}
    </>
  );
}
