"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, PencilLine, X } from "lucide-react";
import { toast } from "sonner";
import type { DeliverableStatus } from "@prisma/client";
import { RelativeTime } from "@/components/relative-time";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { reviewDeliverableAction } from "../actions";

export interface ReviewPanelProps {
  deliverableId: string;
  runId: string;
  workerId: string;
  workerName: string;
  status: DeliverableStatus;
  feedback: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
}

const MAX_FEEDBACK = 4_000;

/**
 * Accept / Reject with optional feedback. Once decided it shows the verdict and offers "Change decision",
 * which reopens the form pre-filled with the previous feedback (the server keeps ONE review per deliverable).
 */
export function ReviewPanel({ deliverableId, runId, workerId, workerName, status, feedback, reviewedByName, reviewedAt }: ReviewPanelProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(status === "PENDING_REVIEW");
  const [text, setText] = useState(feedback ?? "");
  const [pending, startTransition] = useTransition();
  const [inFlight, setInFlight] = useState<"accept" | "reject" | null>(null);

  function decide(decision: "accept" | "reject") {
    if (text.length > MAX_FEEDBACK) {
      toast.error(`Feedback must be at most ${MAX_FEEDBACK.toLocaleString("en-US")} characters`);
      return;
    }
    setInFlight(decision);
    startTransition(async () => {
      const r = await reviewDeliverableAction(deliverableId, decision, text, { runId, workerId });
      setInFlight(null);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(decision === "accept" ? `Accepted — ${workerName} will take note` : `Sent back to ${workerName} with your feedback`);
      setEditing(false);
      router.refresh();
    });
  }

  const decided = status !== "PENDING_REVIEW";
  const accepted = status === "ACCEPTED";

  return (
    <Card className={cn(!decided && "ring-amber-200")}>
      <CardHeader>
        <CardTitle>Review</CardTitle>
        <CardDescription>
          {decided
            ? `${accepted ? "Accepted" : "Rejected"}${reviewedByName ? ` by ${reviewedByName}` : ""}`
            : `Your call counts toward ${workerName}’s score and guides any replacement.`}
          {decided && reviewedAt ? (
            <>
              {" · "}
              <RelativeTime iso={reviewedAt} />
            </>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {decided && !editing ? (
          <>
            <div
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium",
                accepted ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700",
              )}
            >
              {accepted ? <Check className="size-4" aria-hidden="true" /> : <X className="size-4" aria-hidden="true" />}
              {accepted ? "You accepted this deliverable" : "You sent this deliverable back"}
            </div>
            {feedback ? (
              <blockquote className="border-l-2 pl-3 text-sm text-pretty italic text-muted-foreground">“{feedback}”</blockquote>
            ) : (
              <p className="text-sm text-muted-foreground">No feedback was left.</p>
            )}
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <PencilLine aria-hidden="true" /> Change decision
            </Button>
          </>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="deliverable-feedback">Feedback for {workerName} (optional)</Label>
              <Textarea
                id="deliverable-feedback"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="What was good, what was missing, what to do differently next time…"
                rows={4}
                maxLength={MAX_FEEDBACK}
                disabled={pending}
              />
              <p className="text-xs text-muted-foreground">Rejections with specific feedback make the strongest case when proposing a replacement.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => decide("accept")} disabled={pending}>
                {inFlight === "accept" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
                Accept
              </Button>
              <Button variant="destructive" onClick={() => decide("reject")} disabled={pending}>
                {inFlight === "reject" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <X aria-hidden="true" />}
                Reject
              </Button>
              {decided ? (
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    setText(feedback ?? "");
                    setEditing(false);
                  }}
                >
                  Keep current decision
                </Button>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
