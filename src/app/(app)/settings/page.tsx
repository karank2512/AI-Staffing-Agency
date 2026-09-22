import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/server/auth";
import { getSettingsPage } from "@/server/queries/settings";
import { CredentialsCard } from "./_components/credentials-card";
import { ProvidersCard } from "./_components/providers-card";
import { DemoDataCard, ExecutorCard } from "./_components/runtime-cards";
import { WorkspaceCard } from "./_components/workspace-card";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const s = await requireSession();
  const settings = await getSettingsPage(s.organizationId, { role: s.role });
  const canManage = settings.permissions["credentials.manage"];
  const simulatedMode = settings.providers.mode === "simulated";

  return (
    <>
      <PageHeader
        title="Settings"
        description={`Signed in as ${s.name} (${s.email}) · ${settings.workspace.organizationName}. Providers and the executor are configured on the server; tool keys live here.`}
      />

      <div className="space-y-8">
        <WorkspaceCard workspace={settings.workspace} currentUserId={s.userId} />
        <ProvidersCard providers={settings.providers} />
        <CredentialsCard credentials={settings.credentials} simulatedMode={simulatedMode} canManage={canManage} />
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Executor tuning is platform-operator config: owners only (audit INF-19). */}
          {settings.operator ? <ExecutorCard executor={settings.operator.executor} /> : null}
          <DemoDataCard />
        </div>
      </div>
    </>
  );
}
