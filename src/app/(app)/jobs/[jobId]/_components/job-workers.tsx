import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { RelativeTime } from "@/components/relative-time";
import { ScoreRing } from "@/components/score-ring";
import { StatusBadge } from "@/components/status-badge";
import { WorkerAvatar } from "@/components/worker-avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { pluralize } from "@/lib/format";
import type { JobWorkerItem } from "@/server/queries/jobs";

function WorkerRow({ worker }: { worker: JobWorkerItem }) {
  const facts = [worker.title, worker.versionNumber ? `v${worker.versionNumber}` : null, pluralize(worker.runs, "run")]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="border-b border-border py-4 first:pt-0 last:border-0 last:pb-0">
      <Link href={`/workers/${worker.id}`} className="group/worker flex items-center gap-3 outline-none">
        <WorkerAvatar name={worker.name} color={worker.avatarColor} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-foreground group-hover/worker:text-link">{worker.name}</span>
          <span className="block truncate text-footnote text-muted-foreground">{facts}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-footnote text-muted-foreground">
            <StatusBadge kind="worker" status={worker.status} />
            <span aria-hidden="true">·</span>
            {worker.status === "RETIRED" && worker.retiredAt ? (
              <span>
                retired <RelativeTime iso={worker.retiredAt} />
              </span>
            ) : worker.lastRunAt ? (
              <span>
                last worked <RelativeTime iso={worker.lastRunAt} />
              </span>
            ) : (
              <span>
                hired <RelativeTime iso={worker.hiredAt} />
              </span>
            )}
          </span>
        </span>
        <ScoreRing score={worker.score} size={36} />
      </Link>
    </li>
  );
}

/** The seat's history: whoever holds it now, then everyone who held it before. */
export function JobWorkers({ workers, currentWorkerId }: { workers: JobWorkerItem[]; currentWorkerId: string | null }) {
  const current = workers.filter((w) => w.id === currentWorkerId);
  const former = workers.filter((w) => w.id !== currentWorkerId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workers on this job</CardTitle>
        <CardDescription>
          {workers.length === 0
            ? "Nobody has been hired yet."
            : current.length > 0
              ? "Who holds the seat, and who held it before."
              : "Former workers on this seat."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {workers.length === 0 ? (
          <EmptyState title="No worker yet" description="Once you hire, they show up here with their score." className="py-10" />
        ) : (
          <ul>
            {[...current, ...former].map((w) => (
              <WorkerRow key={w.id} worker={w} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
