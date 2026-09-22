import { LocalNav } from "@/components/shell/local-nav";
import { cn } from "@/lib/utils";
import { WORKER_TAB_LABELS, WORKER_TABS, type WorkerTab } from "../_tabs/types";

export interface WorkerTabNavProps {
  workerId: string;
  /** Persona name — the chat tab reads "Talk to Alex", and the bar reveals the name on scroll. */
  workerName: string;
  active: WorkerTab;
  className?: string;
}

/** Display labels stay in the tab nav: the ids and `WORKER_TAB_LABELS` are the frozen seam. */
function labelFor(tab: WorkerTab, workerName: string): string {
  return tab === "chat" ? `Talk to ${workerName}` : WORKER_TAB_LABELS[tab];
}

export function tabHref(workerId: string, tab: WorkerTab): string {
  return tab === "overview" ? `/workers/${workerId}` : `/workers/${workerId}?tab=${tab}`;
}

/**
 * The profile's section bar: the shared frosted LocalNav, mounted full-bleed under the global nav. Every tab is
 * a real URL, so the back button and shared links work; on a narrow screen the links scroll sideways.
 */
export function WorkerTabNav({ workerId, workerName, active, className }: WorkerTabNavProps) {
  const items = WORKER_TABS.map((tab) => ({
    label: labelFor(tab, workerName),
    href: tabHref(workerId, tab),
    active: tab === active,
  }));

  // The page column is 1200px wide; the bar itself spans the window, like the global nav above it.
  return <LocalNav title={workerName} items={items} className={cn("ml-[calc(50%-50vw)] w-dvw", className)} />;
}
