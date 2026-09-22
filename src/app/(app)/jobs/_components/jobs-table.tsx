import Link from "next/link";
import { RelativeTime } from "@/components/relative-time";
import { StatusBadge } from "@/components/status-badge";
import { WorkerAvatar } from "@/components/worker-avatar";
import { Card } from "@/components/ui/card";
import { pluralize } from "@/lib/format";
import type { JobListItem } from "@/server/queries/jobs";

/** One quiet line under the title: what kind of work it is, how often, and what it has produced. */
function subtitle(job: JobListItem): string {
  const parts = [job.familyLabel];
  if (job.cadence) parts.push(job.cadence);
  if (job.deliverables > 0) parts.push(pluralize(job.deliverables, "deliverable"));
  return parts.join(" · ");
}

/**
 * The jobs index: hairline rows, no zebra, no chevron column. Every row is the job, and the whole row is the
 * link — including the setup-stage ones, whose detail page offers "Continue setup" as its primary action.
 */
export function JobsTable({ jobs }: { jobs: JobListItem[] }) {
  return (
    <Card className="gap-0 py-0">
      <div className="hidden items-center gap-6 border-b border-border px-6 text-[13px] font-semibold text-muted-foreground sm:flex sm:h-11">
        <span className="min-w-0 flex-1">Job</span>
        <span className="w-44">Worker</span>
        <span className="w-36">Status</span>
        <span className="w-28 text-right">Last run</span>
      </div>

      <ul>
        {jobs.map((job) => (
          <li
            key={job.id}
            className="relative not-last:after:pointer-events-none not-last:after:absolute not-last:after:inset-x-6 not-last:after:bottom-0 not-last:after:h-px not-last:after:bg-border"
          >
            <Link
              href={`/jobs/${job.id}`}
              className="group/row flex flex-col gap-2.5 px-6 py-4 outline-none transition-colors duration-200 ease-standard hover:bg-[#f9f9fb] focus-visible:bg-[#f9f9fb] sm:h-16 sm:flex-row sm:items-center sm:gap-6 sm:py-0"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-foreground group-hover/row:text-link">{job.title}</span>
                <span className="block truncate text-footnote text-muted-foreground">{subtitle(job)}</span>
              </span>

              <span className="hidden w-44 shrink-0 items-center gap-2 sm:flex">
                {job.worker ? (
                  <>
                    <WorkerAvatar name={job.worker.name} color={job.worker.avatarColor} size="sm" />
                    <span className="truncate text-footnote text-foreground">{job.worker.name}</span>
                  </>
                ) : (
                  <span className="text-footnote text-muted-foreground">Seat open</span>
                )}
              </span>
              <span className="hidden w-36 shrink-0 sm:block">
                <StatusBadge kind="job" status={job.status} />
              </span>
              <span className="hidden w-28 shrink-0 text-right text-footnote text-muted-foreground sm:block">
                <RelativeTime iso={job.lastRunAt} />
              </span>

              <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-footnote text-muted-foreground sm:hidden">
                <StatusBadge kind="job" status={job.status} />
                <span aria-hidden="true">·</span>
                <span>{job.worker ? job.worker.name : "Seat open"}</span>
                <span aria-hidden="true">·</span>
                <RelativeTime iso={job.lastRunAt} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
