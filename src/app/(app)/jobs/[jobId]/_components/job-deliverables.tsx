import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { RelativeTime } from "@/components/relative-time";
import { StatusBadge } from "@/components/status-badge";
import { WorkerAvatar } from "@/components/worker-avatar";
import { Card } from "@/components/ui/card";
import type { JobDeliverableItem } from "@/server/queries/jobs";
import { formatLabel } from "../../_components/labels";

/** What the job has produced so far, newest first. Each row opens the deliverable with its review controls. */
export function JobDeliverables({ deliverables }: { deliverables: JobDeliverableItem[] }) {
  if (deliverables.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Nothing handed in yet"
          description="Deliverables land here as soon as a run completes."
          className="py-14"
        />
      </Card>
    );
  }

  return (
    <Card className="gap-0 py-0">
      <ul>
        {deliverables.map((d) => (
          <li
            key={d.id}
            className="relative not-last:after:pointer-events-none not-last:after:absolute not-last:after:inset-x-6 not-last:after:bottom-0 not-last:after:h-px not-last:after:bg-border"
          >
            <Link
              href={`/deliverables/${d.id}`}
              className="group/row flex flex-col gap-2 px-6 py-4 outline-none transition-colors duration-200 ease-standard hover:bg-[#f9f9fb] focus-visible:bg-[#f9f9fb] sm:flex-row sm:items-center sm:gap-6"
            >
              <span className="flex min-w-0 flex-1 items-center gap-3">
                <WorkerAvatar name={d.worker.name} color={d.worker.avatarColor} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground group-hover/row:text-link">{d.title}</span>
                  <span className="block truncate text-footnote text-muted-foreground">
                    {formatLabel(d.format)} · {d.worker.name} handed this in <RelativeTime iso={d.createdAt} />
                  </span>
                </span>
              </span>
              <span className="shrink-0 pl-11 sm:pl-0">
                <StatusBadge kind="deliverable" status={d.status} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
