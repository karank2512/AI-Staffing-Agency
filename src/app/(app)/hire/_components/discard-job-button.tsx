"use client";

import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { discardJobAction } from "../actions";

/** "Start over": discards the unstaffed job (questions, spec drafts and any proposal) and returns to Describe. */
export function DiscardJobButton({ jobId, disabled, label = "Start over" }: { jobId: string; disabled?: boolean; label?: string }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button type="button" variant="ghost" size="sm" disabled={disabled} className="text-muted-foreground">
          <RotateCcw aria-hidden="true" />
          {label}
        </Button>
      }
      title="Start over?"
      description="This discards the job description, your answers and any draft spec or proposal. Nothing has been hired, so there is nothing else to undo."
      confirmLabel="Discard and start over"
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
