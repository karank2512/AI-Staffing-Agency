"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hireWorkerAction, proposeWorkerAction, reviseJobSpecAction } from "../actions";
import { WORKER_NAME_MAX_CHARS } from "../schema";
import { DiscardJobLink } from "./discard-job-button";
import { InlineError, StepBar, stepLinkClass } from "./step-bar";

export interface ProposalActionsProps {
  jobId: string;
  proposedName: string;
  /** Simulated designs are deterministic, so "design a different worker" is told apart from a real redesign. */
  simulated: boolean;
  /** workers.hire */
  canHire: boolean;
  /** jobs.manage — revising the spec, redesigning and discarding all go through it. */
  canManage: boolean;
}

type Kind = "hire" | "regenerate" | "revise";

/**
 * The one decision of the flow: hire them, or ask for changes. Everything else — a different name, a different
 * design, discarding the job — is a quiet text link, so the page keeps exactly one primary pill.
 */
export function ProposalActions({ jobId, proposedName, simulated, canHire, canManage }: ProposalActionsProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [kind, setKind] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const active = pending ? kind : null;
  const displayName = name.trim().length > 0 ? name.trim() : proposedName;
  const nameTooLong = name.trim().length > WORKER_NAME_MAX_CHARS;

  function run(which: Kind, task: () => Promise<void>) {
    if (pending) return;
    setKind(which);
    setError(null);
    startTransition(task);
  }

  function hire() {
    run("hire", async () => {
      const result = await hireWorkerAction(jobId, name.trim().length > 0 ? { name: name.trim() } : {});
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      const { workerName, firstRunQueued, redirectTo } = result.data;
      toast.success(firstRunQueued ? `You hired ${workerName}. First run is starting.` : `You hired ${workerName}.`, {
        description: firstRunQueued
          ? "Follow the first run on their profile — the deliverable lands there when it finishes."
          : "Start a run from their profile whenever you are ready.",
      });
      router.push(redirectTo);
    });
  }

  function regenerate() {
    run("regenerate", async () => {
      const result = await proposeWorkerAction(jobId, { regenerate: true });
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      // The mock designer is a pure function of the spec: same spec → same worker. Say so instead of pretending.
      if (simulated && result.data.workerName === proposedName) {
        toast.success(`Designed again — ${proposedName} is still the best fit.`, {
          description: "Simulated mode designs deterministically. Change the job spec to change the design.",
        });
      } else {
        toast.success(`Redesigned the worker. Meet ${result.data.workerName}.`);
      }
      router.refresh();
    });
  }

  function backToSpec() {
    run("revise", async () => {
      const result = await reviseJobSpecAction(jobId);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Back to the job spec. Approve it again to get a fresh proposal.");
      router.refresh();
    });
  }

  // A fragment, not a wrapper: StepBar's sticky half has to sit directly in the page column to travel with the
  // scroll on a phone. A short wrapping div would pin it to the very bottom of this long profile instead.
  return (
    <>
      {renaming ? (
        <div className="mt-8 max-w-sm space-y-1.5">
          <Label htmlFor="worker-name">Call them something else</Label>
          <Input
            id="worker-name"
            autoFocus
            value={name}
            maxLength={WORKER_NAME_MAX_CHARS + 10}
            placeholder={proposedName}
            disabled={pending}
            aria-invalid={nameTooLong ? true : undefined}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
          />
          {nameTooLong ? <p className="text-footnote text-danger">Keep it under {WORKER_NAME_MAX_CHARS} characters.</p> : null}
        </div>
      ) : null}

      {error ? <InlineError className="mt-6">{error}</InlineError> : null}

      <StepBar
        note={
          canHire ? (
            <>
              <span className="block">Their first run starts right away. Pause, replace or retire them any time.</span>
              <span className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 max-sm:justify-center">
                {renaming ? null : (
                  <button type="button" onClick={() => setRenaming(true)} disabled={pending} className={stepLinkClass}>
                    Use a different name
                  </button>
                )}
                {canManage ? (
                  <button type="button" onClick={regenerate} disabled={pending} className={stepLinkClass}>
                    {active === "regenerate" ? "Designing…" : "Design a different worker"}
                  </button>
                ) : null}
                {canManage ? <DiscardJobLink jobId={jobId} disabled={pending} /> : null}
              </span>
            </>
          ) : (
            "Only workspace admins and owners can hire workers. Ask one of them to make the call."
          )
        }
      >
        {canManage ? (
          <Button type="button" variant="secondary" size="lg" onClick={backToSpec} disabled={pending} className="max-sm:w-full">
            {active === "revise" ? "Opening the spec…" : "Ask for changes"}
          </Button>
        ) : null}
        <Button
          type="button"
          size="lg"
          onClick={hire}
          aria-busy={pending}
          disabled={pending || nameTooLong || !canHire}
          className="max-sm:w-full"
        >
          {active === "hire" ? `Hiring ${displayName}…` : `Hire ${displayName}`}
        </Button>
      </StepBar>
    </>
  );
}
