"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { decideApprovalAction } from "../actions";
import { DECISION_NOTE_MAX, type Decision } from "../schema";

export interface ApprovalDecisionProps {
  approvalId: string;
  /** "Maya" — used in the confirmation copy and the toast. */
  workerName: string;
  /** Registry display name of the tool: "Notifications". */
  toolLabel: string;
  /** Compact = the inline pair on the Workforce attention strip. */
  size?: "default" | "sm";
}

const COPY: Record<Decision, { title: (name: string) => string; body: (name: string, tool: string) => string; confirm: string; success: (name: string) => string }> = {
  approve: {
    title: (name) => `Let ${name} go ahead?`,
    body: (name, tool) => `${name} will use ${tool} exactly as shown and then carry on with the run.`,
    confirm: "Approve",
    success: (name) => `Approved — ${name} is picking up where they left off.`,
  },
  reject: {
    title: (name) => `Tell ${name} not to do this?`,
    body: (name) => `${name} will skip this action and finish the run without it. A short note helps them adapt.`,
    confirm: "Reject",
    success: (name) => `Rejected — ${name} will finish the run without it.`,
  },
};

/** Approve / Reject pair. Each opens a confirmation with an optional note that lands on the approval record. */
export function ApprovalDecision({ approvalId, workerName, toolLabel, size = "default" }: ApprovalDecisionProps) {
  const router = useRouter();
  const [note, setNote] = useState("");

  async function decide(decision: Decision) {
    const result = await decideApprovalAction(approvalId, decision, note);
    // Thrown errors keep the dialog open and are toasted by ConfirmDialog.
    if (!result.ok) throw new Error(result.error);
    toast.success(COPY[decision].success(workerName));
    setNote("");
    router.refresh();
  }

  function description(decision: Decision) {
    const noteId = `note-${approvalId}-${decision}`;
    return (
      <div className="space-y-3">
        <p>{COPY[decision].body(workerName, toolLabel)}</p>
        <div className="space-y-1.5">
          <Label htmlFor={noteId} className="text-xs">
            Note <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id={noteId}
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, DECISION_NOTE_MAX))}
            placeholder={decision === "approve" ? "Looks good — send it." : "Not this week, the numbers need a second look."}
            rows={2}
            className="resize-none text-sm"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <ConfirmDialog
        trigger={
          <Button type="button" variant="outline" size={size}>
            <X aria-hidden="true" /> Reject
          </Button>
        }
        title={COPY.reject.title(workerName)}
        description={description("reject")}
        confirmLabel={COPY.reject.confirm}
        destructive
        onConfirm={() => decide("reject")}
      />
      <ConfirmDialog
        trigger={
          <Button type="button" size={size}>
            <Check aria-hidden="true" /> Approve
          </Button>
        }
        title={COPY.approve.title(workerName)}
        description={description("approve")}
        confirmLabel={COPY.approve.confirm}
        onConfirm={() => decide("approve")}
      />
    </div>
  );
}
