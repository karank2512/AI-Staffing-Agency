"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HIRE_HREF, NAV_GROUPS, isActivePath } from "./nav-items";

export interface SidebarNavProps {
  pendingApprovals: number;
}

/** Client island of the sidebar: it needs `usePathname()` for the active state. */
export function SidebarNav({ pendingApprovals }: SidebarNavProps) {
  const pathname = usePathname() ?? "";
  const counters = { pendingApprovals } as const;

  return (
    <nav aria-label="Main" className="flex flex-col gap-5">
      <Button asChild size="lg" className="w-full justify-start gap-2 px-3 shadow-xs">
        <Link href={HIRE_HREF} aria-current={isActivePath(pathname, [HIRE_HREF]) ? "page" : undefined}>
          <Plus className="size-4" aria-hidden="true" />
          Hire a worker
        </Link>
      </Button>

      {NAV_GROUPS.map((group, groupIndex) => (
        <div key={group.label ?? groupIndex} className="flex flex-col gap-0.5">
          {group.label ? <p className="eyebrow mb-1 px-2.5">{group.label}</p> : null}
          {group.items.map((item) => {
            const active = isActivePath(pathname, item.match);
            const count = item.badge ? counters[item.badge] : 0;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group/nav flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring/60",
                  active
                    ? "bg-card text-foreground shadow-xs ring-1 ring-foreground/10"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon
                  className={cn(
                    "size-4 shrink-0 transition-colors",
                    active ? "text-primary" : "text-muted-foreground group-hover/nav:text-sidebar-accent-foreground",
                  )}
                  aria-hidden="true"
                />
                <span className="truncate">{item.label}</span>
                {count > 0 ? (
                  <span
                    className="ml-auto inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-amber-100 px-1.5 text-[11px] leading-none font-semibold text-amber-800 tabular-nums ring-1 ring-amber-200 ring-inset"
                    aria-label={`${count} pending ${count === 1 ? "approval" : "approvals"}`}
                  >
                    {count > 99 ? "99+" : count}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
