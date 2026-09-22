import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, Briefcase, History, Quote } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RelativeTime } from "@/components/relative-time";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { requireSession } from "@/server/auth";
import { computeNextRunAt, describeCadence } from "@/server/domain";
import { isAppError } from "@/server/errors";
import { getHireView, listOpenHireJobs, type HireView, type OpenHireJob } from "@/server/queries/hire";
import { ClarifyForm } from "./_components/clarify-form";
import { DescribeForm } from "./_components/describe-form";
import { ProposalActions } from "./_components/proposal-actions";
import { ProposalCard } from "./_components/proposal-card";
import { ProposalDetails } from "./_components/proposal-details";
import { ProposalPending } from "./_components/proposal-pending";
import { SpecActions } from "./_components/spec-actions";
import { SpecEditor } from "./_components/spec-editor";
import { SpecReview } from "./_components/spec-review";
import { HireStepper } from "./_components/stepper";
import { stepKeyFor, type HireStepKey } from "./schema";

export const metadata: Metadata = { title: "Hire a worker" };

const STEP_COPY: Record<HireStepKey, { title: string; description: string }> = {
  describe: {
    title: "Hire a worker",
    description: "Describe the job in plain English. We scope it, design an AI worker for it, and you hire them — usually in under three minutes.",
  },
  clarify: { title: "Hire a worker", description: "A few quick questions so the job spec matches what you meant." },
  spec: { title: "Review the job spec", description: "This is the contract your worker is hired against. Edit what is off, then approve it to meet your proposed hire." },
  proposal: { title: "Meet your worker", description: "Here is who we would put on the job. Hire them, ask for a redesign, or go back and adjust the spec." },
  hired: { title: "Hired", description: "Your worker is on the job." },
};

/**
 * /hire and /hire?jobId=… — the headline flow. The step is always derived on the server from
 * `staffing.getHireFlowState`; the client only ever submits an action and refreshes.
 */
export default async function HirePage({ searchParams }: { searchParams: Promise<{ jobId?: string | string[] }> }) {
  const s = await requireSession();
  const { jobId: rawJobId } = await searchParams;
  const jobId = Array.isArray(rawJobId) ? rawJobId[0] : rawJobId;

  if (!jobId) {
    const openJobs = await listOpenHireJobs(s.organizationId);
    return (
      <>
        <PageHeader title={STEP_COPY.describe.title} description={STEP_COPY.describe.description} />
        <div className="space-y-8">
          <HireStepper current="describe" />
          <DescribeForm />
          {openJobs.length > 0 ? <ResumeList jobs={openJobs} /> : null}
        </div>
      </>
    );
  }

  let view: HireView;
  try {
    view = await getHireView(s.organizationId, jobId);
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }

  // A staffed job has nothing left to hire — send them to the worker who holds it.
  if (view.kind === "staffed") {
    if (view.workerId) redirect(`/workers/${view.workerId}`);
    return <ClosedJob jobId={view.jobId} status={view.status} />;
  }

  const { state, toolMeta, familyLabel } = view;
  const step = stepKeyFor(state.step);
  const copy = STEP_COPY[step];

  return (
    <>
      <PageHeader
        title={copy.title}
        description={copy.description}
        breadcrumbs={[{ label: "Hire", href: "/hire" }, { label: state.job.title }]}
        actions={
          <>
            <StatusBadge kind="job" status={state.job.status} />
            <Button variant="outline" size="sm" asChild>
              <Link href={`/jobs/${state.job.id}`}>
                <Briefcase aria-hidden="true" />
                View job
              </Link>
            </Button>
          </>
        }
      />
      <div className="space-y-8">
        <HireStepper current={step} />

        {step === "clarify" ? (
          <div className="space-y-4">
            <Card size="sm" className="bg-muted/40">
              <CardContent className="flex gap-3">
                <Quote className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 space-y-1">
                  <p className="eyebrow">
                    Your description · {familyLabel}
                  </p>
                  <p className="text-sm whitespace-pre-line text-pretty text-muted-foreground">{state.job.description}</p>
                </div>
              </CardContent>
            </Card>
            <ClarifyForm jobId={state.job.id} jobTitle={state.job.title} questions={state.intake?.questions ?? []} initialAnswers={state.intake?.answers ?? {}} />
          </div>
        ) : null}

        {step === "spec" && state.spec && state.jobSpecId ? (
          <div className="space-y-4">
            <SpecEditor
              jobId={state.job.id}
              jobSpecId={state.jobSpecId}
              familyLabel={familyLabel}
              statusLabel="Draft spec"
              title={state.spec.title}
              summary={state.spec.summary}
              objective={state.spec.objective}
              responsibilities={state.spec.responsibilities}
              cadence={state.spec.cadence}
              targetCount={state.spec.deliverable.targetCount ?? null}
              showTargetCount={state.spec.deliverable.fields.length > 0 || state.spec.deliverable.targetCount !== undefined}
            />
            <SpecReview spec={state.spec} toolMeta={toolMeta} />
            <SpecActions jobId={state.job.id} jobSpecId={state.jobSpecId} specTitle={state.spec.title} />
          </div>
        ) : null}

        {step === "proposal" && state.spec ? (
          state.proposal ? (
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                <ProposalCard proposal={state.proposal} jobTitle={state.spec.title} toolMeta={toolMeta} />
                <ProposalDetails proposal={state.proposal} />
              </div>
              <aside className="self-start">
                <ProposalActions
                  jobId={state.job.id}
                  proposedName={state.proposal.blueprint.persona.name}
                  title={state.spec.title}
                  perRunUsd={state.proposal.blueprint.costEstimate.perRunUsd}
                  monthlyUsd={state.proposal.blueprint.costEstimate.monthlyUsd}
                  cadenceLabel={describeCadence(state.proposal.blueprint.schedule)}
                  firstRunLabel={firstRunLabel(state.proposal.blueprint.schedule)}
                  simulated={state.proposal.simulated}
                />
              </aside>
            </div>
          ) : (
            <ProposalPending jobId={state.job.id} specTitle={state.spec.title} />
          )
        ) : null}
      </div>
    </>
  );
}

/** "First run starts on hire; then …" — the schedule math is the same the hire uses, evaluated now for display. */
function firstRunLabel(schedule: Parameters<typeof computeNextRunAt>[0]): string {
  const next = computeNextRunAt(schedule, new Date());
  return next ? `First run on hire, then ${formatDateTime(next)}` : "First run on hire, then whenever you ask";
}

function ResumeList({ jobs }: { jobs: OpenHireJob[] }) {
  return (
    <Section title="Pick up where you left off" description="Jobs you started scoping but have not hired for yet.">
      <Card>
        <CardContent>
          <ul className="divide-y">
            {jobs.map((job) => (
              <li key={job.id}>
                <Link href={`/hire?jobId=${encodeURIComponent(job.id)}`} className="group flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-foreground/5">
                    <History className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium group-hover:underline">{job.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {job.familyLabel} · updated <RelativeTime iso={job.updatedAt} />
                    </span>
                  </span>
                  <StatusBadge kind="job" status={job.status} />
                  <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </Section>
  );
}

function ClosedJob({ jobId, status }: { jobId: string; status: string }) {
  const paused = status === "PAUSED";
  return (
    <>
      <PageHeader title="Hire a worker" description="This job is not open for hiring." breadcrumbs={[{ label: "Hire", href: "/hire" }, { label: "Job" }]} />
      <EmptyState
        icon={Briefcase}
        title={paused ? "This job is paused" : "This job is closed"}
        description={
          paused
            ? "Its worker is paused rather than gone. Resume them from the Workforce page, or open the job for details."
            : "Its worker has been retired and the job was closed. Describe a new job to hire again, or open the job for its history."
        }
        action={
          <>
            <Button asChild>
              <Link href="/hire">Describe a new job</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/jobs/${jobId}`}>Open job</Link>
            </Button>
          </>
        }
      />
    </>
  );
}
