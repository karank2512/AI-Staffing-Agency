import Link from "next/link";
import { FileText, Inbox } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { RelativeTime } from "@/components/relative-time";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { WorkerAvatar } from "@/components/worker-avatar";
import type { JobDeliverableItem } from "@/server/queries/jobs";
import { formatLabel } from "../../_components/labels";

/** What the job has produced so far, newest first. Each row opens the deliverable with its review controls. */
export function JobDeliverables({ deliverables }: { deliverables: JobDeliverableItem[] }) {
  if (deliverables.length === 0) {
    return <EmptyState icon={Inbox} title="Nothing delivered yet" description="Deliverables land here as soon as a run completes." />;
  }

  return (
    <Card>
      <CardContent>
        <ul className="divide-y">
          {deliverables.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-foreground/5">
                <FileText className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <Link href={`/deliverables/${d.id}`} className="block truncate text-sm font-medium hover:underline">
                  {d.title}
                </Link>
                <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                  <span>{formatLabel(d.format)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    <WorkerAvatar name={d.worker.name} color={d.worker.avatarColor} size="sm" className="size-4 text-[8px]" />
                    {d.worker.name} delivered <RelativeTime iso={d.createdAt} />
                  </span>
                  <span aria-hidden="true">·</span>
                  <Link href={`/runs/${d.runId}`} className="hover:underline">
                    view run
                  </Link>
                </p>
              </div>
              <StatusBadge kind="deliverable" status={d.status} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
