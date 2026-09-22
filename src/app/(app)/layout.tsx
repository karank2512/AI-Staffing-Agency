import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireSession } from "@/server/auth";
import { getShellData } from "@/server/queries/shell";

/** Everything under (app) is authenticated: `requireSession()` redirects to /sign-in when there is no session. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const s = await requireSession();
  const shell = await getShellData(s.organizationId);

  return (
    <AppShell
      user={{ name: s.name, email: s.email, organizationName: s.organizationName }}
      simulated={shell.simulated}
      pendingApprovals={shell.pendingApprovals}
    >
      {children}
    </AppShell>
  );
}
