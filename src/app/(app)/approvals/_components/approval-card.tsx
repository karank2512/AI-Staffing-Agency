import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { RelativeTime } from "@/components/relative-time";
import { SimulatedBadge } from "@/components/simulated-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { WorkerAvatar } from "@/components/worker-avatar";
import type { ApprovalView } from "@/server/queries/approvals";
import { ApprovalDecision } from "./approval-decision";
import { PayloadPreview } from "./payload-preview";
import { requestSentence } from "./request";

export interface ApprovalCardProps {
  approval: ApprovalView;
  /** Why this viewer can't decide, if they can't. The server enforces it either way. */
  disabledReason?: string;
}

/** One waiting request: who is asking, what exactly they will do, and the two ways to answer. */
export function ApprovalCard({ approval, disabledReason }: ApprovalCardProps) {
  const { worker } = approval;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-4">
          <Link href={`/workers/${worker.id}`} className="shrink-0 rounded-full outline-none">
            <WorkerAvatar name={worker.name} color={worker.avatarColor} />
          </Link>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-title-3 text-pretty text-foreground">{requestSentence(worker.name, approval.title)}</p>
            <p className="text-footnote flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground">
              <span>
                Requested <RelativeTime iso={approval.requestedAt} />
              </span>
              <span aria-hidden="true">·</span>
              <span className="truncate">{approval.jobTitle}</span>
              {approval.simulated ? (
                <>
                  <span aria-hidden="true">·</span>
                  <SimulatedBadge />
                </>
              ) : null}
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <PayloadPreview payload={approval.payload} workerName={worker.name} />
      </CardContent>

      <CardFooter className="flex-wrap items-center justify-between gap-x-4 gap-y-4">
        <Button variant="link" asChild>
          <Link href={`/runs/${approval.runId}`}>
            See the paused run <ChevronRight data-icon="inline-end" />
          </Link>
        </Button>
        <ApprovalDecision
          approvalId={approval.id}
          workerName={worker.name}
          toolLabel={approval.toolLabel}
          payload={approval.payload}
          disabledReason={disabledReason}
        />
      </CardFooter>
    </Card>
  );
}
