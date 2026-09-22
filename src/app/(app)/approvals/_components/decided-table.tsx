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
  return approval.status === "EXPIRED" ? "No one — it expired" : EMPTY;
}

/** History of past decisions, newest first. Read-only; a table on desktop, stacked rows on a phone. */
export function DecidedTable({ approvals }: { approvals: ApprovalView[] }) {
  return (
    <Card className="py-0">
      <Table className="max-sm:hidden">
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-72">Request</TableHead>
            <TableHead>Worker</TableHead>
            <TableHead>Decision</TableHead>
            <TableHead>By</TableHead>
            <TableHead className="text-right">When</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {approvals.map((approval) => (
            <TableRow key={approval.id}>
              <TableCell className="py-4 align-top whitespace-normal">
                <Link href={`/runs/${approval.runId}`} className="font-medium text-foreground outline-none hover:text-link">
                  {approval.title}
                </Link>
                {approval.note ? (
                  <p className="text-footnote mt-0.5 max-w-lg text-pretty text-muted-foreground">
                    “{approval.note}”
                  </p>
                ) : null}
              </TableCell>
              <TableCell className="align-top">
                <Link
                  href={`/workers/${approval.worker.id}`}
                  className="flex items-center gap-2 text-callout outline-none hover:text-link"
                >
                  <WorkerAvatar name={approval.worker.name} color={approval.worker.avatarColor} size="xs" />
                  {approval.worker.name}
                </Link>
              </TableCell>
              <TableCell className="align-top">
                <StatusBadge kind="approval" status={approval.status} emphasis="dot" />
              </TableCell>
              <TableCell className="text-callout align-top text-muted-foreground">{decidedBy(approval)}</TableCell>
              <TableCell className="text-footnote text-right align-top text-muted-foreground tabular-nums">
                <RelativeTime iso={approval.decidedAt ?? approval.requestedAt} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <ul className="divide-y divide-border px-5 sm:hidden">
        {approvals.map((approval) => (
          <li key={approval.id} className="space-y-1.5 py-4">
            <Link href={`/runs/${approval.runId}`} className="text-body-app block text-pretty font-medium text-foreground">
              {approval.title}
            </Link>
            <p className="text-footnote flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground">
              <span>{approval.worker.name}</span>
              <span aria-hidden="true">·</span>
              <span>{decidedBy(approval)}</span>
              <span aria-hidden="true">·</span>
              <RelativeTime iso={approval.decidedAt ?? approval.requestedAt} />
            </p>
            <StatusBadge kind="approval" status={approval.status} emphasis="dot" />
          </li>
        ))}
      </ul>
    </Card>
  );
}
