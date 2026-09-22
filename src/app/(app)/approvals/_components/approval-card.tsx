import Link from "next/link";
import { ArrowUpRight, Wrench } from "lucide-react";
import { JsonView } from "@/components/json-view";
import { RelativeTime } from "@/components/relative-time";
import { SimulatedBadge } from "@/components/simulated-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { WorkerAvatar } from "@/components/worker-avatar";
import type { ApprovalView } from "@/server/queries/approvals";
import { ApprovalDecision } from "./approval-decision";

/** One pending request: who is asking, what exactly they will do (the payload), and the decision controls. */
export function ApprovalCard({ approval }: { approval: ApprovalView }) {
  const { worker } = approval;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <Link href={`/workers/${worker.id}`} className="shrink-0 rounded-full">
            <WorkerAvatar name={worker.name} color={worker.avatarColor} />
          </Link>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-semibold text-balance text-foreground">{approval.title}</p>
            {approval.description ? (
              <p className="text-sm text-pretty text-muted-foreground">{approval.description}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5 text-xs text-muted-foreground">
              <Link href={`/workers/${worker.id}`} className="font-medium text-foreground hover:underline">
                {worker.name}
              </Link>
              <span aria-hidden="true">·</span>
              <span className="truncate">{worker.title}</span>
              <span aria-hidden="true">·</span>
              <span>
                asked <RelativeTime iso={approval.requestedAt} />
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            <Badge variant="outline">
              <Wrench aria-hidden="true" />
              {approval.toolLabel}
            </Badge>
            {approval.simulated ? <SimulatedBadge /> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <JsonView label={`What ${worker.name} will send`} value={approval.payload} defaultOpen />
      </CardContent>
      <CardFooter className="flex-wrap justify-between gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/runs/${approval.runId}`}>
            View the paused run <ArrowUpRight aria-hidden="true" />
          </Link>
        </Button>
        <ApprovalDecision approvalId={approval.id} workerName={worker.name} toolLabel={approval.toolLabel} />
      </CardFooter>
    </Card>
  );
}
