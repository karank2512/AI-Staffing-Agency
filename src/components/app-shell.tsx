import type { ReactNode } from "react";
import Link from "next/link";
import { SimulatedBadge } from "@/components/simulated-badge";
import { Wordmark } from "@/components/shell/logo";
import { MobileNav } from "@/components/shell/mobile-nav";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { UserMenu, type ShellUser } from "@/components/shell/user-menu";

export interface AppShellProps {
  user: ShellUser;
  /** `llm.isSimulated()` — shows the global Simulated badge. */
  simulated: boolean;
  /** Approvals awaiting a decision; shown as a count on the Approvals nav item. */
  pendingApprovals: number;
  children: ReactNode;
}

/**
 * Authenticated chrome: fixed left rail (w-60) on `md+`, a top bar + left Sheet below that, and the page
 * container (`max-w-7xl`). Rendered once by `src/app/(app)/layout.tsx`; pages render only their own content,
 * starting with `<PageHeader>`.
 *
 * Server component — the interactive parts (active nav state, user menu, mobile sheet) are small client islands.
 */
export function AppShell({ user, simulated, pendingApprovals, children }: AppShellProps) {
  const sidebar = <SidebarBody user={user} simulated={simulated} pendingApprovals={pendingApprovals} />;

  return (
    <div className="min-h-dvh bg-background">
      <a
        href="#main"
        className="sr-only rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        {sidebar}
      </aside>

      <div className="flex min-h-dvh flex-col md:pl-60">
        <header className="sticky top-0 z-20 flex h-13 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-sm md:hidden">
          <MobileNav pendingApprovals={pendingApprovals}>{sidebar}</MobileNav>
          <Link href="/workforce" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
            <Wordmark />
          </Link>
          {simulated ? <SimulatedBadge className="ml-auto" /> : null}
        </header>

        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

/** Shared by the desktop rail and the mobile sheet so the two can never drift apart. */
function SidebarBody({ user, simulated, pendingApprovals }: Omit<AppShellProps, "children">) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center px-4">
        <Link href="/workforce" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/60">
          <Wordmark />
        </Link>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-4">
        <SidebarNav pendingApprovals={pendingApprovals} />
      </div>

      <div className="shrink-0 space-y-2 border-t border-sidebar-border p-3">
        {simulated ? (
          <div className="flex items-center gap-2 px-1.5 pt-0.5">
            <SimulatedBadge />
            <span className="truncate text-xs text-muted-foreground">No live model keys</span>
          </div>
        ) : null}
        <UserMenu user={user} />
      </div>
    </div>
  );
}
