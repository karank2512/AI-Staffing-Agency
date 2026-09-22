import Link from "next/link";
import { ArrowRight, History } from "lucide-react";
import { RelativeTime } from "@/components/relative-time";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { WorkerAvatar } from "@/components/worker-avatar";
import { EMPTY, formatDate, formatNumber } from "@/lib/format";
import type { JobListItem } from "@/server/queries/jobs";

/** A job still being set up continues in the hire flow; everything else opens its history page. */
function primaryLabel(job: JobListItem): string {
  if (job.status === "DRAFT") return "Continue setup";
  if (job.status === "SPEC_APPROVED") return job.hasHistory ? "Hire again" : "Hire";
  return "View";
}

export function JobsTable({ jobs }: { jobs: JobListItem[] }) {
  return (
    <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4">Job</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Worker</TableHead>
            <TableHead>Cadence</TableHead>
            <TableHead>Last run</TableHead>
            <TableHead className="text-right">Deliverables</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="pr-4 text-right">
              <span className="sr-only">Open</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => (
            <TableRow key={job.id}>
              <TableCell className="max-w-[28rem] pl-4">
                <Link href={job.href} className="block min-w-0 font-medium text-foreground hover:underline">
                  <span className="block truncate">{job.title}</span>
                </Link>
                <span className="block truncate text-xs text-muted-foreground">{job.familyLabel}</span>
              </TableCell>
              <TableCell>
                <StatusBadge kind="job" status={job.status} />
              </TableCell>
              <TableCell>
                {job.worker ? (
                  <Link href={`/workers/${job.worker.id}`} className="inline-flex items-center gap-2 hover:underline">
                    <WorkerAvatar name={job.worker.name} color={job.worker.avatarColor} size="sm" />
                    <span className="font-medium">{job.worker.name}</span>
                    {job.worker.status === "PAUSED" ? (
                      <span className="text-xs text-muted-foreground">(paused)</span>
                    ) : null}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">{EMPTY}</span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">{job.cadence ?? EMPTY}</TableCell>
              <TableCell className="text-muted-foreground">
                <RelativeTime iso={job.lastRunAt} />
              </TableCell>
              <TableCell className="metric text-right">
                {job.deliverables > 0 ? formatNumber(job.deliverables, 0) : <span className="text-muted-foreground">{EMPTY}</span>}
              </TableCell>
              <TableCell className="text-muted-foreground" title={job.createdAt}>
                {formatDate(job.createdAt)}
              </TableCell>
              <TableCell className="pr-4 text-right">
                <span className="inline-flex items-center justify-end gap-3">
                  {job.hasHistory && job.href.startsWith("/hire") ? (
                    <Link
                      href={`/jobs/${job.id}`}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
                    >
                      <History className="size-3.5" aria-hidden="true" />
                      History
                    </Link>
                  ) : null}
                  <Link href={job.href} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                    {primaryLabel(job)}
                    <ArrowRight className="size-3.5" aria-hidden="true" />
                  </Link>
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
