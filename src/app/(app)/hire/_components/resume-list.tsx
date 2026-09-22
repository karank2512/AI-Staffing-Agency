import Link from "next/link";
import type { OpenHireJob } from "@/server/queries/hire";
import { RelativeTime } from "@/components/relative-time";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";

/**
 * "Pick up where you left off" — jobs that were scoped but never hired for. Hairline rows, one sentence each,
 * metadata demoted; no icon tiles and no trailing chevrons.
 */
export function ResumeList({ jobs }: { jobs: OpenHireJob[] }) {
  return (
    <section className="space-y-4">
      <h2 className="text-title-3 text-muted-foreground">Pick up where you left off</h2>
      <Card className="py-0">
        <CardContent className="divide-y divide-border px-0">
          {jobs.map((job) => (
            <Link
              key={job.id}
              href={`/hire?jobId=${encodeURIComponent(job.id)}`}
              className="flex items-center justify-between gap-5 px-6 py-4 transition-colors duration-200 ease-standard hover:bg-accent"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{job.title}</span>
                <span className="block text-footnote text-muted-foreground">
                  {job.familyLabel} · updated <RelativeTime iso={job.updatedAt} />
                </span>
              </span>
              <StatusBadge kind="job" status={job.status} />
            </Link>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}
