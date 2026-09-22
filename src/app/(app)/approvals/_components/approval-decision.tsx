"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { decideApprovalAction } from "../actions";
import { DECISION_NOTE_MAX, type Decision } from "../schema";
import { PayloadPreview } from "./payload-preview";

export interface ApprovalDecisionProps {
  approvalId: string;
  /** "Maya" — used in the confirmation copy and the toast. */
  workerName: string;
  /** Registry display name of the tool: "Notifications". */
  toolLabel: string;
  /** Compact = the inline pair on the Workforce "Needs you" band. */
  size?: "default" | "sm";
  /**
   * The exact tool input awaiting approval. Every surface should pass it: the confirmation then shows the
   * recipients, subject and message, so nobody approves a send they haven't read.
   */
  payload?: unknown;
  /**
   * The page's one blue pill belongs to the decision only where deciding *is* the page (/approvals). Elsewhere
   * both pills are gray.
   */
  emphasis?: "primary" | "quiet";
  /** Set when the viewer's role may not decide this request: the controls go flat and say why. */
  disabledReason?: string;
}

const COPY: Record<Decision, { title: (name: string) => string; body: (name: string, tool: string) => string; confirm: string; success: (name: string) => string; label: string; noteLabel: string; placeholder: string }> = {
  approve: {
    title: (name) => `Let ${name} go ahead?`,
    body: (name, tool) => `${name} will use ${tool} exactly as shown, then carry on with the run.`,
    confirm: "Approve",
    success: (name) => `Approved — ${name} is picking up where they left off.`,
    label: "Approve",
    noteLabel: "Note",
    placeholder: "Looks good — send it.",
  },
  reject: {
    title: (name) => `Tell ${name} not to do this?`,
    body: (name) => `${name} will skip this action and finish the run without it. A short reason helps them adapt.`,
    confirm: "Decline",
    success: (name) => `Declined — ${name} will finish the run without it.`,
    label: "Decline",
    noteLabel: "Reason",
    placeholder: "Not this week — the numbers need a second look.",
  },
};

/** Approve / Decline pair. Each opens a confirmation carrying the full request and an optional note. */
export function ApprovalDecision({
  approvalId,
  workerName,
  toolLabel,
  size = "default",
  payload,
  emphasis = "primary",
  disabledReason,
}: ApprovalDecisionProps) {
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

  // 44px touch targets on a phone: the h-9 pills stretch to the card's width there.
  const pill = size === "default" ? "max-sm:h-11 max-sm:flex-1" : undefined;
  const row = size === "default" ? "flex shrink-0 items-center gap-2 max-sm:w-full" : "flex shrink-0 items-center gap-2";

  if (disabledReason) {
    return (
      <div className="flex shrink-0 flex-col items-start gap-1.5 max-sm:w-full sm:items-end">
        <div className={row}>
          <Button type="button" variant="secondary" size={size} className={pill} disabled>
            {COPY.reject.label}
          </Button>
          <Button type="button" variant="secondary" size={size} className={pill} disabled>
            {COPY.approve.label}
          </Button>
        </div>
        <p className="text-footnote max-w-64 text-pretty text-muted-foreground sm:text-right">{disabledReason}</p>
      </div>
    );
  }

  function description(decision: Decision) {
    const noteId = `note-${approvalId}-${decision}`;
    return (
      <div className="space-y-4">
        <p>{COPY[decision].body(workerName, toolLabel)}</p>
        {payload !== undefined ? <PayloadPreview payload={payload} workerName={workerName} compact /> : null}
        <div className="space-y-1.5">
          <Label htmlFor={noteId}>
            {COPY[decision].noteLabel} <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id={noteId}
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, DECISION_NOTE_MAX))}
            placeholder={COPY[decision].placeholder}
            rows={2}
            className="resize-none"
          />
        </div>
      </div>
    );
  }

  return (
    <div className={row}>
      <ConfirmDialog
        trigger={
          <Button type="button" variant="secondary" size={size} className={pill}>
            {COPY.reject.label}
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
          <Button type="button" variant={emphasis === "primary" ? "default" : "secondary"} size={size} className={pill}>
            {COPY.approve.label}
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
