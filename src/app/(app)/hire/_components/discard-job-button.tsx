"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { cn } from "@/lib/utils";
import { discardJobAction } from "../actions";
import { stepLinkClass } from "./step-bar";

/**
 * "Discard this job": throws away the description, answers and any draft spec or proposal. Nothing has been
 * hired yet, so there is nothing else to undo — but it is still a one-way door, hence the confirm.
 *
 * Rendered as a danger-coloured text link, never a button: the flow already has its one primary pill.
 */
export function DiscardJobLink({ jobId, disabled, label = "Discard this job", className }: { jobId: string; disabled?: boolean; label?: string; className?: string }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <button
          type="button"
          disabled={disabled}
          className={cn(stepLinkClass, "text-footnote text-danger", className)}
        >
          {label}
        </button>
      }
      title="Discard this job?"
      description="This throws away the description, your answers and any draft spec or proposal. Nothing has been hired, so there is nothing else to undo."
      confirmLabel="Discard"
      destructive
      onConfirm={async () => {
        const result = await discardJobAction(jobId);
        if (!result.ok) throw new Error(result.error);
        toast.success("Discarded. Describe a new job whenever you are ready.");
        router.push(result.data.redirectTo);
      }}
    />
  );
}
