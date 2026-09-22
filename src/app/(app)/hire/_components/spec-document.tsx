"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { describeCadence, type JobSpec } from "@/server/domain";
import type { ToolMeta } from "@/server/queries/hire";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { approveSpecAndProposeAction, updateJobSpecAction } from "../actions";
import { SpecPatchSchema, designNarrative } from "../schema";
import { DesigningPanel } from "./designing-panel";
import { DiscardJobLink } from "./discard-job-button";
import { AssumptionsSection, BoundariesSection, CriteriaSection, DeliverableSection, DocList, DocSection, SourcesSection } from "./spec-body";
import { EditShell, OutcomeFields, OverviewFields, ScheduleFields, diffSpecPatch, toSpecForm, type SpecForm, type SpecFormSource } from "./spec-edit";
import { InlineError, StepBar } from "./step-bar";

export interface SpecDocumentProps {
  jobId: string;
  jobSpecId: string;
  spec: JobSpec;
  toolMeta: Record<string, ToolMeta>;
  /** Records per run only means something for record-based deliverables. */
  showTargetCount: boolean;
  /** jobs.manage — a MEMBER reads the spec but cannot edit or approve it (the server refuses either way). */
  canManage: boolean;
}

type EditSection = "overview" | "outcome" | "schedule";

/**
 * Step 3 — the job spec as a readable document. Headings and prose, hairlines between sections, and an "Edit"
 * link on each section the server will actually accept a patch for (title/summary, objective/responsibilities,
 * schedule/target). Approving hands off to the designer in one round-trip, so the wait is one calm panel.
 */
export function SpecDocument({ jobId, jobSpecId, spec, toolMeta, showTargetCount, canManage }: SpecDocumentProps) {
  const router = useRouter();
  const source: SpecFormSource = {
    title: spec.title,
    summary: spec.summary,
    objective: spec.objective,
    responsibilities: spec.responsibilities,
    cadence: spec.cadence,
    targetCount: spec.deliverable.targetCount ?? null,
  };

  const [editing, setEditing] = useState<EditSection | null>(null);
  const [form, setForm] = useState<SpecForm>(() => toSpecForm(source));
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [approving, startApprove] = useTransition();

  function open(section: EditSection) {
    setForm(toSpecForm(source));
    setSaveError(null);
    setEditing(section);
  }

  function close() {
    setEditing(null);
    setSaveError(null);
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const patch = diffSpecPatch(source, form, showTargetCount);
    if (Object.keys(patch).length === 0) {
      close();
      return;
    }
    const parsed = SpecPatchSchema.safeParse(patch);
    if (!parsed.success) {
      setSaveError(parsed.error.issues[0]?.message ?? "Please check the highlighted fields.");
      return;
    }
    setSaveError(null);
    startSave(async () => {
      const result = await updateJobSpecAction(jobId, jobSpecId, parsed.data);
      if (!result.ok) {
        setSaveError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Spec updated.");
      setEditing(null);
      router.refresh();
    });
  }

  function approve() {
    if (approving) return;
    setError(null);
    startApprove(async () => {
      const result = await approveSpecAndProposeAction(jobId, jobSpecId);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        // The approval may have committed before the design failed; let the server re-derive the step.
        router.refresh();
        return;
      }
      toast.success(`Spec approved. Meet ${result.data.workerName}, your proposed hire.`);
      router.refresh();
    });
  }

  if (approving) return <DesigningPanel lines={designNarrative(spec.title)} />;

  const editLink = (section: EditSection) =>
    canManage && editing === null ? (
      <Button type="button" variant="link" onClick={() => open(section)} className="text-footnote">
        Edit
      </Button>
    ) : null;

  return (
    <>
      {editing === "overview" ? (
        <header className="mb-10">
          <h1 className="sr-only">{spec.title}</h1>
          <Card>
            <CardContent>
              <form onSubmit={save} aria-busy={saving}>
                <EditShell error={saveError} pending={saving} onCancel={close}>
                  <OverviewFields form={form} setForm={setForm} pending={saving} />
                </EditShell>
              </form>
            </CardContent>
          </Card>
        </header>
      ) : (
        <PageHeader
          title={<span className="block text-headline">{spec.title}</span>}
          description={spec.summary}
          backHref="/hire"
          backLabel="Hire"
          actions={editLink("overview")}
        />
      )}

      <Card className="[--card-spacing:--spacing(8)] max-sm:[--card-spacing:--spacing(6)]">
        <CardContent className="divide-y divide-border">
          <DocSection title="The outcome" action={editLink("outcome")}>
            {editing === "outcome" ? (
              <form onSubmit={save} aria-busy={saving}>
                <EditShell error={saveError} pending={saving} onCancel={close}>
                  <OutcomeFields form={form} setForm={setForm} pending={saving} />
                </EditShell>
              </form>
            ) : (
              <>
                <p>{spec.objective}</p>
                <div className="space-y-2.5">
                  <p className="text-callout font-medium text-muted-foreground">On every run</p>
                  <DocList items={spec.responsibilities} ordered />
                </div>
              </>
            )}
          </DocSection>

          <DeliverableSection spec={spec} />

          <DocSection title="Schedule" action={editLink("schedule")}>
            {editing === "schedule" ? (
              <form onSubmit={save} aria-busy={saving}>
                <EditShell error={saveError} pending={saving} onCancel={close}>
                  <ScheduleFields form={form} setForm={setForm} pending={saving} showTargetCount={showTargetCount} />
                </EditShell>
              </form>
            ) : (
              <p>
                {describeCadence(spec.cadence)}
                {showTargetCount ? (
                  <span className="text-muted-foreground">
                    {" · "}
                    {spec.deliverable.targetCount ? (
                      <>
                        about <span className="metric">{spec.deliverable.targetCount}</span> records per run
                      </>
                    ) : (
                      "no fixed target per run"
                    )}
                  </span>
                ) : null}
              </p>
            )}
          </DocSection>

          <SourcesSection spec={spec} toolMeta={toolMeta} />
          <CriteriaSection spec={spec} />
          <BoundariesSection spec={spec} />
          <AssumptionsSection spec={spec} />
        </CardContent>
      </Card>

      {error ? <InlineError className="mt-6">{error}</InlineError> : null}

      <StepBar
        note={
          canManage ? (
            <>
              Approving locks this version of the spec — you can still revise it before hiring.{" "}
              <DiscardJobLink jobId={jobId} disabled={editing !== null} />
            </>
          ) : (
            "Only workspace admins and owners can approve a job spec. Ask one of them to take it from here."
          )
        }
      >
        <Button type="button" size="lg" onClick={approve} disabled={!canManage || editing !== null} className="max-sm:w-full">
          Looks right — design my worker
        </Button>
      </StepBar>
    </>
  );
}
