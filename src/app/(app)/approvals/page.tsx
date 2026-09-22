import type { Metadata } from "next";
import Link from "next/link";
import { History, ShieldCheck } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { pluralize } from "@/lib/format";
import { requireSession } from "@/server/auth";
import { getApprovalsPage } from "@/server/queries/approvals";
import { ApprovalCard } from "./_components/approval-card";
import { DecidedTable } from "./_components/decided-table";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ worker?: string }> }) {
  const [s, params] = await Promise.all([requireSession(), searchParams]);
  const workerId = params.worker?.trim() || undefined;
  const { pending, decided } = await getApprovalsPage(s.organizationId, { workerId });
  const workerName = pending[0]?.worker.name ?? decided[0]?.worker.name ?? null;

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Actions your workers want to take that need a human's OK first — you see exactly what will happen before it does."
        actions={
          workerId ? (
            <Button variant="outline" size="sm" asChild>
              <Link href="/approvals">Show all workers</Link>
            </Button>
          ) : undefined
        }
      />

      <div className="space-y-8">
        <Section
          title="Waiting on you"
          description={
            pending.length === 0
              ? "Nothing needs a decision right now."
              : `${pluralize(pending.length, "request")} paused until you decide${workerName && workerId ? ` · filtered to ${workerName}` : ""}.`
          }
        >
          {pending.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="You're all caught up"
              description="When a worker wants to do something that needs sign-off — like sending a report to stakeholders — it will pause here and wait for you."
              action={
                <Button variant="outline" asChild>
                  <Link href="/workforce">Back to Workforce</Link>
                </Button>
              }
            />
          ) : (
            <div className="grid gap-4">
              {pending.map((approval) => (
                <ApprovalCard key={approval.id} approval={approval} />
              ))}
            </div>
          )}
        </Section>

        <Section title="Decided" description="Past decisions, newest first — who approved what, and why.">
          {decided.length === 0 ? (
            <EmptyState icon={History} title="No decisions yet" description="Approved, rejected and expired requests will show up here." />
          ) : (
            <DecidedTable approvals={decided} />
          )}
        </Section>
      </div>

      {/* A pending request can be resolved from the run page or expire when its run is cancelled; keep the list honest. */}
      <AutoRefresh active={pending.length > 0} intervalMs={6000} />
    </>
  );
}
