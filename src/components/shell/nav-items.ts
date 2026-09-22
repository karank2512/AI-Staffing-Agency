import { Activity, Briefcase, ChartColumn, Settings, ShieldCheck, Users, type LucideIcon } from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /**
   * Path prefixes that light this item up. Detail routes live outside their list's URL space
   * (`/workers/[id]`, `/runs/[id]`, `/deliverables/[id]` all belong to Workforce), so `href` alone is not enough.
   */
  match: readonly string[];
  /** Which live counter (if any) to show as a badge. */
  badge?: "pendingApprovals";
}

export interface NavGroup {
  /** Small caption above the group; the first group has none. */
  label?: string;
  items: readonly NavItem[];
}

/** "Hire" is intentionally absent: it is the primary button above the nav, not a destination among equals. */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    items: [
      { label: "Workforce", href: "/workforce", icon: Users, match: ["/workforce", "/workers", "/runs", "/deliverables"] },
      { label: "Jobs", href: "/jobs", icon: Briefcase, match: ["/jobs"] },
      { label: "Approvals", href: "/approvals", icon: ShieldCheck, match: ["/approvals"], badge: "pendingApprovals" },
      { label: "Activity", href: "/activity", icon: Activity, match: ["/activity"] },
    ],
  },
  {
    label: "Workspace",
    items: [
      { label: "Usage", href: "/usage", icon: ChartColumn, match: ["/usage"] },
      { label: "Settings", href: "/settings", icon: Settings, match: ["/settings"] },
    ],
  },
];

export const HIRE_HREF = "/hire";

/** Segment-aware prefix match: "/jobs" matches "/jobs" and "/jobs/abc" but not "/jobs-archive". */
export function isActivePath(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
