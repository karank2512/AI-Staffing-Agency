"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { JsonView } from "@/components/json-view";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { decideApprovalAction } from "../actions";
import { useRunLive } from "./run-live";

export interface ApprovalDecisionProps {
  runId: string;
  workerId: string;
  workerName: string;
  approval: { id: string; title: string; description: string | null; toolName: string; payload: unknown };
}

/** Inline Approve / Decline for a pending request, rendered inside the APPROVAL step while the run waits. */
export function ApprovalDecision({ runId, workerId, workerName, approval }: ApprovalDecisionProps) {
  const { refresh } = useRunLive();
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [decided, setDecided] = useState<"approve" | "reject" | null>(null);

  function decide(decision: "approve" | "reject") {
    startTransition(async () => {
      const r = await decideApprovalAction(runId, approval.id, decision, note, workerId);
      if (!r.ok) {
        toast.error(r.error);
        // The request may have expired underneath us — re-render so the row shows its real state.
        refresh();
        return;
      }
      setDecided(decision);
      toast.success(decision === "approve" ? `${workerName} can go ahead` : `${workerName} will carry on without it`);
      refresh();
    });
  }

  if (decided) {
    return (
      <p className="text-sm text-muted-foreground">
        {decided === "approve" ? "Approved" : "Declined"} — {workerName} is picking the run back up.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">{approval.title}</p>
        {approval.description ? <p className="mt-0.5 text-sm text-pretty text-muted-foreground">{approval.description}</p> : null}
      </div>
      <JsonView label="What will be sent" value={approval.payload} defaultOpen />
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note for the record (e.g. why you declined)"
        rows={2}
        maxLength={1000}
        disabled={pending}
        aria-label="Decision note"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => decide("approve")} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
          Approve
        </Button>
        <Button size="sm" variant="destructive" onClick={() => decide("reject")} disabled={pending}>
          <X aria-hidden="true" /> Decline
        </Button>
        <span className="text-xs text-muted-foreground">Declining lets {workerName} finish without this step.</span>
      </div>
    </div>
  );
}
