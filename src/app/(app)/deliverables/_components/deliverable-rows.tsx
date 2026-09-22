import Link from "next/link";
import { RelativeTime } from "@/components/relative-time";
import { StatusBadge } from "@/components/status-badge";
import { WorkerAvatar } from "@/components/worker-avatar";
import { Card } from "@/components/ui/card";
import { EMPTY, pluralize } from "@/lib/format";
import type { DeliverableListItem } from "@/server/queries/deliverables";

/** "Report", "CSV", "JSON" — what the worker actually handed over. */
export const FORMAT_LABEL = { MARKDOWN: "Report", CSV: "CSV", JSON: "JSON" } as const;

function subtitle(d: DeliverableListItem): string {
  const parts = [FORMAT_LABEL[d.format], d.worker.name, d.job.title];
  if (d.recordCount !== null) parts.push(pluralize(d.recordCount, "record"));
  return parts.join(" · ");
}

/** Everything handed in, as hairline rows: the title leads, the facts stay quiet on the right. */
export function DeliverableRows({ items }: { items: DeliverableListItem[] }) {
  return (
    <Card className="gap-0 py-0">
      <div className="hidden items-center gap-6 border-b border-border px-6 text-[13px] font-semibold text-muted-foreground sm:flex sm:h-11">
        <span className="min-w-0 flex-1">Deliverable</span>
        <span className="w-36">Status</span>
        <span className="w-14 text-right">Score</span>
        <span className="w-28 text-right">Delivered</span>
      </div>

      <ul>
        {items.map((d) => (
          <li
            key={d.id}
            className="relative not-last:after:pointer-events-none not-last:after:absolute not-last:after:inset-x-6 not-last:after:bottom-0 not-last:after:h-px not-last:after:bg-border"
          >
            <Link
              href={`/deliverables/${d.id}`}
              className="group/row flex flex-col gap-2.5 px-6 py-4 outline-none transition-colors duration-200 ease-standard hover:bg-[#f9f9fb] focus-visible:bg-[#f9f9fb] sm:h-16 sm:flex-row sm:items-center sm:gap-6 sm:py-0"
            >
              <span className="flex min-w-0 flex-1 items-center gap-3">
                <WorkerAvatar name={d.worker.name} color={d.worker.avatarColor} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground group-hover/row:text-link">{d.title}</span>
                  <span className="block truncate text-footnote text-muted-foreground">{subtitle(d)}</span>
                </span>
              </span>

              <span className="hidden w-36 shrink-0 sm:block">
                <StatusBadge kind="deliverable" status={d.status} />
              </span>
              <span className="metric hidden w-14 shrink-0 text-right text-foreground sm:block">{d.score ?? EMPTY}</span>
              <span className="hidden w-28 shrink-0 text-right text-footnote text-muted-foreground sm:block">
                <RelativeTime iso={d.createdAt} />
              </span>

              <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-11 text-footnote text-muted-foreground sm:hidden">
                <StatusBadge kind="deliverable" status={d.status} />
                <span aria-hidden="true">·</span>
                <span className="metric">{d.score === null ? "Not scored" : `Scored ${d.score}`}</span>
                <span aria-hidden="true">·</span>
                <RelativeTime iso={d.createdAt} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
