import Link from "next/link";
import { Users } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { RelativeTime } from "@/components/relative-time";
import { ScoreRing } from "@/components/score-ring";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkerAvatar } from "@/components/worker-avatar";
import { pluralize } from "@/lib/format";
import type { JobWorkerItem } from "@/server/queries/jobs";

function WorkerRow({ worker, current }: { worker: JobWorkerItem; current: boolean }) {
  return (
    <li className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <Link href={`/workers/${worker.id}`} className="shrink-0">
        <WorkerAvatar name={worker.name} color={worker.avatarColor} />
      </Link>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link href={`/workers/${worker.id}`} className="truncate text-sm font-medium hover:underline">
            {worker.name}
          </Link>
          <StatusBadge kind="worker" status={worker.status} />
          {current && worker.health !== "UNKNOWN" ? <StatusBadge kind="health" status={worker.health} /> : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {worker.title}
          {worker.versionNumber ? ` · v${worker.versionNumber}` : ""}
          {" · "}
          {pluralize(worker.runs, "run")}
        </p>
        <p className="text-xs text-muted-foreground">
          {worker.status === "RETIRED" && worker.retiredAt ? (
            <>
              Retired <RelativeTime iso={worker.retiredAt} />
            </>
          ) : worker.lastRunAt ? (
            <>
              Last worked <RelativeTime iso={worker.lastRunAt} />
            </>
          ) : (
            <>
              Hired <RelativeTime iso={worker.hiredAt} />
            </>
          )}
        </p>
      </div>
      <ScoreRing score={worker.score} size={32} />
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
          {workers.length === 0 ? "Nobody has been hired yet." : current.length > 0 ? "Who holds the seat, and who held it before." : "Former workers on this seat."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {workers.length === 0 ? (
          <EmptyState icon={Users} title="No worker yet" description="Once you hire, they show up here with their score." className="py-8" />
        ) : (
          <ul className="divide-y">
            {current.map((w) => (
              <WorkerRow key={w.id} worker={w} current />
            ))}
            {former.map((w) => (
              <WorkerRow key={w.id} worker={w} current={false} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
