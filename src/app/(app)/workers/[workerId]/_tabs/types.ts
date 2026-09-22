import type { SessionContext } from "@/server/auth/types";

/**
 * FROZEN seam between the worker profile page (owner: profile-core) and the tab components
 * (split between profile-core and profile-manage). Each tab is an async server component that
 * loads its own data through an org-scoped query and renders content only (no PageHeader).
 */
export const WORKER_TABS = [
  "overview",
  "activity",
  "deliverables",
  "performance",
  "cost",
  "permissions",
  "chat",
  "versions",
  "debug",
] as const;
export type WorkerTab = (typeof WORKER_TABS)[number];

export const WORKER_TAB_LABELS: Record<WorkerTab, string> = {
  overview: "Overview",
  activity: "Activity",
  deliverables: "Deliverables",
  performance: "Performance",
  cost: "Cost",
  permissions: "Permissions",
  chat: "Talk to worker",
  versions: "Versions",
  debug: "Debug",
};

export interface WorkerTabProps {
  session: SessionContext;
  workerId: string;
  /** Persona name for copy ("Alex delivered…"). */
  workerName: string;
}

export function isWorkerTab(value: string | undefined): value is WorkerTab {
  return !!value && (WORKER_TABS as readonly string[]).includes(value);
}
