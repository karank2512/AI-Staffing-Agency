import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, History, XCircle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Section } from "@/components/section";
import { SimulatedBadge } from "@/components/simulated-badge";
import { Button } from "@/components/ui/button";
import { WorkerAvatar } from "@/components/worker-avatar";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireSession } from "@/server/auth";
import { isAppError } from "@/server/errors";
import { getReplacePageData, type ReplacePageView } from "@/server/queries/worker-manage";
import { ChangeList } from "./_components/change-list";
import { FailureAnalysis } from "./_components/failure-analysis";
import { ReplaceDecision } from "./_components/replace-decision";
import { impactDescription, replaceCrumb, replacePageTitle, targetNoun } from "./_components/replace-labels";
import { EstimatedDeltas, VersionCompareCard } from "./_components/version-compare";

interface PageProps {
  params: Promise<{ workerId: string; versionId: string }>;
}

/** generateMetadata and the page share one load per request. */
const loadPage = cache(async (workerId: string, versionId: string): Promise<ReplacePageView | null> => {
  const s = await requireSession();
  try {
    return await getReplacePageData(s.organizationId, workerId, versionId);
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") return null;
    throw e;
  }
});

/** Depends on the decision too: after the hire the same URL shows the adopted version, not a proposal. */
function pageTitle(data: ReplacePageView): string {
  return replacePageTitle({ workerName: data.worker.name, changeReason: data.changeReason, status: data.target.status, version: data.target.version });
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { workerId, versionId } = await params;
  const data = await loadPage(workerId, versionId);
  return { title: data ? pageTitle(data) : "Proposed version" };
}

export default async function ReplacePage({ params }: PageProps) {
  const { workerId, versionId } = await params;
  const data = await loadPage(workerId, versionId);
  if (!data) notFound();

  const { worker, target, base } = data;
  const labelInput = { changeReason: data.changeReason, status: target.status, version: target.version };
  const crumb = replaceCrumb(labelInput);
  const targetSide = targetNoun(labelInput);
  const baseLabel = base ? (base.status === "ACTIVE" ? "the current version" : `version ${base.version}`) : "nothing";
  const targetLabel = `Version ${target.version}`;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Workforce", href: "/workforce" }, { label: worker.name, href: `/workers/${worker.id}` }, { label: crumb }]}
        title={
          <span className="flex items-center gap-3">
            <WorkerAvatar name={worker.name} color={worker.avatarColor} size="md" />
            <span>{pageTitle(data)}</span>
            {data.simulated ? <SimulatedBadge /> : null}
          </span>
        }
        description={
          target.changeSummary
            ? target.changeSummary.split("\n")[0]
            : base
              ? `Version ${target.version} compared with ${baseLabel}.`
              : `${worker.name}'s first version.`
        }
        actions={
          <Button variant="outline" asChild>
            <Link href={`/workers/${worker.id}?tab=versions`}>
              <History aria-hidden="true" /> All versions
            </Link>
          </Button>
        }
      />

      <div className="space-y-8">
        {!data.canDecide ? <OutcomeBanner data={data} /> : null}

        {data.deltas ? (
          <Section title="Estimated impact" description={impactDescription(data.deltas.source, target.status)}>
            <EstimatedDeltas deltas={data.deltas} base={base} target={target} />
          </Section>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-8 lg:col-span-2">
            {data.analysis ? <FailureAnalysis analysis={data.analysis} workerName={worker.name} /> : null}

            <Section
              title="Side by side"
              description={
                base
                  ? `${baseLabel[0].toUpperCase()}${baseLabel.slice(1)} on the left, ${targetSide} on the right. Highlights mark what ${target.status === "PROPOSED" ? "changes" : "changed"}.`
                  : "The design as proposed."
              }
            >
              <div className={cn("grid gap-4", base && "md:grid-cols-2")}>
                {base ? <VersionCompareCard card={base} against={target} role="base" changeReason={data.changeReason} /> : null}
                <VersionCompareCard card={target} against={base} role="target" changeReason={data.changeReason} />
              </div>
            </Section>

            {base ? (
              <Section
                title={target.status === "PROPOSED" ? "What changes" : "What changed"}
                description={`Every difference between ${baseLabel} and ${targetLabel.toLowerCase()}, in plain terms.`}
              >
                <ChangeList entries={data.diff} baseLabel={baseLabel} targetLabel={targetLabel} />
              </Section>
            ) : null}
          </div>

          <div className="space-y-6 lg:sticky lg:top-6 lg:self-start">
            <ReplaceDecision
              workerId={worker.id}
              workerName={worker.name}
              versionId={target.id}
              version={target.version}
              changeReason={data.changeReason}
              status={target.status}
              canDecide={data.canDecide}
              workerStatus={worker.status}
            />
            <dl className="space-y-1.5 rounded-lg border bg-muted/40 p-4 text-xs text-muted-foreground">
              <Meta label="Proposed" value={formatDateTime(target.createdAt)} />
              {target.activatedAt ? <Meta label="Activated" value={formatDateTime(target.activatedAt)} /> : null}
              {target.retiredAt ? <Meta label="Retired" value={formatDateTime(target.retiredAt)} /> : null}
              <Meta label="Version id" value={target.id} mono />
            </dl>
          </div>
        </div>
      </div>
    </>
  );
}

function OutcomeBanner({ data }: { data: ReplacePageView }) {
  const status = data.target.status;
  const active = status === "ACTIVE";
  const replaced = status === "REPLACED";
  const Icon = active || replaced ? CheckCircle2 : XCircle;
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm",
        active ? "border-emerald-200 bg-emerald-50 text-emerald-900" : replaced ? "border-slate-200 bg-slate-50 text-slate-700" : "border-slate-200 bg-slate-50 text-slate-700",
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", active ? "text-emerald-600" : "text-slate-500")} aria-hidden="true" />
      <p>
        {active ? (
          <>
            <span className="font-medium">This version is now active.</span> {data.worker.name} has worked this way since {formatDateTime(data.target.activatedAt)}.
          </>
        ) : replaced ? (
          <>
            <span className="font-medium">This version has since been replaced.</span> It was active from {formatDateTime(data.target.activatedAt)} to {formatDateTime(data.target.retiredAt)}.
          </>
        ) : (
          <>
            <span className="font-medium">This proposal was declined.</span> {data.worker.name} kept working as before.
          </>
        )}
      </p>
    </div>
  );
}

function Meta({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt>{label}</dt>
      <dd className={cn("truncate text-right text-foreground/80", mono && "font-mono text-[11px]")} title={value}>
        {value}
      </dd>
    </div>
  );
}
