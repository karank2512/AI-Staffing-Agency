import Link from "next/link";
import { RelativeTime } from "@/components/relative-time";
import { StatusBadge } from "@/components/status-badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { WorkerAvatar } from "@/components/worker-avatar";
import { EMPTY } from "@/lib/format";
import type { ApprovalView } from "@/server/queries/approvals";

function decidedBy(approval: ApprovalView): string {
  if (approval.decidedBy) return approval.decidedBy;
  // The runtime expires requests whose run was cancelled or failed; nobody "decided" those.
  return approval.status === "EXPIRED" ? "Expired automatically" : EMPTY;
}

/** History of past decisions, newest first. Read-only. */
export function DecidedTable({ approvals }: { approvals: ApprovalView[] }) {
  return (
    <Card className="overflow-hidden py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-64">Request</TableHead>
            <TableHead>Tool</TableHead>
            <TableHead>Decision</TableHead>
            <TableHead>Decided by</TableHead>
            <TableHead className="text-right">When</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {approvals.map((approval) => (
            <TableRow key={approval.id}>
              <TableCell className="align-top whitespace-normal">
                <div className="flex items-start gap-2.5">
                  <WorkerAvatar name={approval.worker.name} color={approval.worker.avatarColor} size="sm" className="mt-0.5" />
                  <div className="min-w-0 space-y-0.5">
                    <Link href={`/runs/${approval.runId}`} className="font-medium text-foreground hover:underline">
                      {approval.title}
                    </Link>
                    {approval.note ? (
                      <p className="text-xs text-pretty text-muted-foreground">
                        <span className="font-medium">Note:</span> {approval.note}
                      </p>
                    ) : null}
                  </div>
                </div>
              </TableCell>
              <TableCell className="align-top text-muted-foreground">{approval.toolLabel}</TableCell>
              <TableCell className="align-top">
                <StatusBadge kind="approval" status={approval.status} />
              </TableCell>
              <TableCell className="align-top text-muted-foreground">{decidedBy(approval)}</TableCell>
              <TableCell className="text-right align-top text-muted-foreground tabular-nums">
                <RelativeTime iso={approval.decidedAt ?? approval.requestedAt} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
