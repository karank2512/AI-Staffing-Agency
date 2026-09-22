"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { JsonView } from "@/components/json-view";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { titleCase } from "@/lib/format";
import { decideApprovalAction } from "../actions";
import { useRunLive } from "./run-live";

export interface ApprovalDecisionProps {
  runId: string;
  workerId: string;
  workerName: string;
  approval: { id: string; title: string; description: string | null; toolName: string; payload: unknown };
  /** False hides the buttons for a role that may not decide — the runtime enforces the same rule. */
  canDecide?: boolean;
}

/** At most this many payload fields are shown as a readable preview before the full JSON. */
const PREVIEW_FIELDS = 4;
const PREVIEW_CHARS = 220;

/** Scalar-ish payload entries, so "send an email" reads as recipients + subject rather than a JSON blob. */
function previewRows(payload: unknown): Array<{ label: string; value: string }> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const rows: Array<{ label: string; value: string }> = [];
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (rows.length >= PREVIEW_FIELDS) break;
    let text: string | null = null;
    if (typeof value === "string") text = value;
    else if (typeof value === "number" || typeof value === "boolean") text = String(value);
    else if (Array.isArray(value) && value.every((v) => typeof v === "string" || typeof v === "number")) text = value.join(", ");
    if (text === null || text.trim() === "") continue;
    rows.push({
      label: titleCase(key),
      value: text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text,
    });
  }
  return rows;
}

/**
 * Inline Approve / Decline for a pending request, rendered inside the APPROVAL step while the run waits.
 * The decision, the note and the refresh behaviour are unchanged — only the presentation is.
 */
export function ApprovalDecision({ runId, workerId, workerName, approval, canDecide = true }: ApprovalDecisionProps) {
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
      <p className="text-footnote text-muted-foreground">
        {decided === "approve" ? "Approved" : "Declined"} — {workerName} is picking the run back up.
      </p>
    );
  }

  const rows = previewRows(approval.payload);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-title-3 text-pretty">{approval.title}</p>
        {approval.description ? (
          <p className="mt-1 text-[15px] text-pretty text-muted-foreground">{approval.description}</p>
        ) : null}
      </div>

      {rows.length > 0 ? (
        <dl className="text-[15px]">
          {rows.map((row) => (
            <div key={row.label} className="flex gap-4 border-b border-border py-2 last:border-0">
              <dt className="w-28 shrink-0 text-footnote text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 flex-1 text-pretty">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <JsonView label="Everything that will be sent" value={approval.payload} defaultOpen={rows.length === 0} />

      {canDecide ? (
        <>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note for the record — optional"
            rows={2}
            maxLength={1000}
            disabled={pending}
            aria-label="Decision note"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => decide("approve")} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Approve
            </Button>
            <Button variant="secondary" onClick={() => decide("reject")} disabled={pending}>
              Decline
            </Button>
            <span className="text-footnote text-muted-foreground">
              Declining lets {workerName} finish without this step.
            </span>
          </div>
        </>
      ) : (
        <p className="text-footnote text-muted-foreground">
          Your role can’t decide this one. Ask an admin in your workspace to take a look.
        </p>
      )}
    </div>
  );
}
