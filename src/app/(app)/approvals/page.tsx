import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireSession } from "@/server/auth";
import { getApprovalsPage, type ApprovalView } from "@/server/queries/approvals";
import type { ApprovalPermissions } from "@/server/queries/permissions";
import { tools } from "@/server/tools";
import { ApprovalCard } from "./_components/approval-card";
import { DecidedTable } from "./_components/decided-table";
import { ViewTabs } from "./_components/view-tabs";

export const metadata: Metadata = { title: "Approvals" };

interface ApprovalsSearchParams {
  worker?: string;
  view?: string;
}

/**
 * Why this viewer can't decide this request. `decideApproval` re-checks the deciding user's role in the DB, so
 * this only saves them a click — it is never the boundary.
 */
function blockedReason(approval: ApprovalView, permissions: ApprovalPermissions): string | undefined {
  if (!permissions["approvals.decide"]) return "Only workspace members and above can decide requests.";
  const leavesTheWorkspace = tools.get(approval.toolName)?.sideEffect === "external_write";
  if (leavesTheWorkspace && !permissions["approvals.decideExternal"]) {
    return "This one leaves the workspace, so an admin has to answer it.";
  }
  return undefined;
}

function hrefFor(workerId: string | undefined, view: "waiting" | "decided"): string {
  const params = new URLSearchParams();
  if (workerId) params.set("worker", workerId);
  if (view === "decided") params.set("view", "decided");
  const query = params.toString();
  return query ? `/approvals?${query}` : "/approvals";
}

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<ApprovalsSearchParams> }) {
  const [s, params] = await Promise.all([requireSession(), searchParams]);
  const workerId = params.worker?.trim() || undefined;
  const view = params.view === "decided" ? "decided" : "waiting";
  const { pending, decided, permissions } = await getApprovalsPage(s.organizationId, { workerId, role: s.role });
  const workerName = pending[0]?.worker.name ?? decided[0]?.worker.name ?? null;

  return (
    <>
      <PageHeader title="Approvals" description="Actions your workers won't take without you." />

      <div className="space-y-8">
        <ViewTabs
          label="Which requests to show"
          tabs={[
            { label: "Waiting", href: hrefFor(workerId, "waiting"), active: view === "waiting", count: pending.length },
            { label: "Decided", href: hrefFor(workerId, "decided"), active: view === "decided" },
          ]}
        />

        {workerId ? (
          <p className="text-footnote flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
            <span>Only {workerName ?? "one worker"}&apos;s requests.</span>
            <Button variant="link" asChild>
              <Link href={view === "decided" ? "/approvals?view=decided" : "/approvals"}>Show everyone</Link>
            </Button>
          </p>
        ) : null}

        {view === "waiting" ? (
          pending.length === 0 ? (
            <Card>
              <EmptyState
                title="You're all caught up."
                description="New requests will appear here and in the nav. A worker pauses mid-run when it wants to do something you said needs your sign-off."
                action={
                  <Button variant="secondary" size="lg" asChild>
                    <Link href="/workforce">Back to Workforce</Link>
                  </Button>
                }
              />
            </Card>
          ) : (
            <div className="max-w-[820px] space-y-6">
              {pending.map((approval) => (
                <ApprovalCard key={approval.id} approval={approval} disabledReason={blockedReason(approval, permissions)} />
              ))}
            </div>
          )
        ) : decided.length === 0 ? (
          <Card>
            <EmptyState
              title="No decisions yet"
              description="Once you answer a request, it moves here with who decided it and why."
            />
          </Card>
        ) : (
          <DecidedTable approvals={decided} />
        )}
      </div>

      {/* A pending request can be resolved from the run page or expire when its run is cancelled; keep the list honest. */}
      <AutoRefresh active={view === "waiting" && pending.length > 0} intervalMs={6000} />
    </>
  );
}
