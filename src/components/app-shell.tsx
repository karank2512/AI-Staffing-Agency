import type { ReactNode } from "react";
import { GlobalNav } from "@/components/shell/global-nav";
import type { ShellUser } from "@/components/shell/user-menu";

export interface AppShellProps {
  user: ShellUser;
  /** `llm.isSimulated()` — shows the global Simulated chip. */
  simulated: boolean;
  /** Approvals awaiting a decision; shown as a count pill on the Approvals link. */
  pendingApprovals: number;
  children: ReactNode;
}

/**
 * Authenticated chrome: a frosted global top bar over a full-bleed #f5f5f7 canvas, with content in a 1200px
 * column. Rendered once by `src/app/(app)/layout.tsx`; pages render only their own content, starting with
 * `<PageHeader>`. Server component — the bar itself is the one client island.
 */
export function AppShell({ user, simulated, pendingApprovals, children }: AppShellProps) {
  return (
    <div className="min-h-dvh bg-canvas">
      <a
        href="#main"
        className="sr-only rounded-full bg-primary px-4 py-2 text-footnote font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to content
      </a>

      <GlobalNav user={user} simulated={simulated} pendingApprovals={pendingApprovals} />

      <main id="main" className="text-body-app mx-auto w-full max-w-(--container-app) px-4 pt-10 pb-24 sm:px-6">
        {children}
      </main>
    </div>
  );
}
