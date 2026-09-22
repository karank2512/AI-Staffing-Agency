export interface NavItem {
  label: string;
  href: string;
  /**
   * Path prefixes that light this item up. Detail routes live outside their list's URL space
   * (`/workers/[id]`, `/runs/[id]`, `/deliverables/[id]` all belong to Workforce), so `href` alone is not enough.
   */
  match: readonly string[];
  /** Which live counter (if any) to show as a pill after the label. */
  badge?: "pendingApprovals";
}

/**
 * The four destinations in the global bar. There are no icons: navigation is plain text.
 * "Hire" is the primary pill, not a destination among equals; Usage and Settings live in the user menu.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Workforce", href: "/workforce", match: ["/workforce", "/workers", "/runs", "/deliverables"] },
  { label: "Jobs", href: "/jobs", match: ["/jobs"] },
  { label: "Approvals", href: "/approvals", match: ["/approvals"], badge: "pendingApprovals" },
  { label: "Activity", href: "/activity", match: ["/activity"] },
];

/** Secondary destinations, shown in the user menu on desktop and below the primary links on mobile. */
export const ACCOUNT_ITEMS: readonly NavItem[] = [
  { label: "Usage", href: "/usage", match: ["/usage"] },
  { label: "Settings", href: "/settings", match: ["/settings"] },
];

export const HIRE_HREF = "/hire";

/** Segment-aware prefix match: "/jobs" matches "/jobs" and "/jobs/abc" but not "/jobs-archive". */
export function isActivePath(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** "3" up to 99, then "99+" — the pill must never widen the nav. */
export function formatCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

/** Screen-reader text for the Approvals count pill. */
export function approvalsLabel(count: number): string {
  return `${count} pending ${count === 1 ? "approval" : "approvals"}`;
}
