import Link from "next/link";
import { cn } from "@/lib/utils";
import { WORKER_TAB_LABELS, WORKER_TABS, type WorkerTab } from "../_tabs/types";

export interface WorkerTabNavProps {
  workerId: string;
  active: WorkerTab;
  /** Small counters shown next to a label ("Deliverables 3"). */
  counts?: Partial<Record<WorkerTab, number>>;
  className?: string;
}

/**
 * Tabs-styled navigation driven by `?tab=` so every tab is a real, shareable URL (and the browser back button
 * works). Server-rendered links — no client state to keep in sync.
 */
export function WorkerTabNav({ workerId, active, counts, className }: WorkerTabNavProps) {
  return (
    <nav aria-label="Worker profile sections" className={cn("-mx-1 overflow-x-auto", className)}>
      <ul role="list" className="flex min-w-max items-center gap-1 border-b border-border px-1">
        {WORKER_TABS.map((tab) => {
          const isActive = tab === active;
          const count = counts?.[tab];
          return (
            <li key={tab}>
              <Link
                href={tab === "overview" ? `/workers/${workerId}` : `/workers/${workerId}?tab=${tab}`}
                scroll={false}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "relative inline-flex h-9 items-center gap-1.5 rounded-t-md px-2.5 text-sm font-medium whitespace-nowrap transition-colors outline-none",
                  "after:absolute after:inset-x-1 after:-bottom-px after:h-0.5 after:rounded-full after:transition-opacity",
                  "focus-visible:ring-2 focus-visible:ring-ring/50",
                  isActive
                    ? "text-foreground after:bg-primary after:opacity-100"
                    : "text-muted-foreground after:opacity-0 hover:bg-muted/60 hover:text-foreground",
                )}
              >
                {WORKER_TAB_LABELS[tab]}
                {typeof count === "number" && count > 0 ? (
                  <span className="rounded-full bg-muted px-1.5 text-[11px] leading-4 font-medium text-muted-foreground tabular-nums">
                    {count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
