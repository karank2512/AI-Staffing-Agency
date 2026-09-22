"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Handshake, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatUsd, formatUsdPrecise } from "@/lib/format";
import { hireWorkerAction, proposeWorkerAction, reviseJobSpecAction } from "../actions";
import { WORKER_NAME_MAX_CHARS } from "../schema";
import { DiscardJobButton } from "./discard-job-button";

export interface ProposalActionsProps {
  jobId: string;
  proposedName: string;
  title: string;
  perRunUsd: number;
  monthlyUsd: number;
  cadenceLabel: string;
  firstRunLabel: string;
  /** Simulated designs are deterministic, so "Regenerate" is told apart from a real redesign in the toast. */
  simulated: boolean;
}

type Kind = "hire" | "regenerate" | "revise";

/**
 * The hire panel next to the proposal. One primary action ("Hire Alex"), an optional rename, and two ways back:
 * regenerate the design or return to the spec. The transition covers the action AND the router refresh / push
 * that follows, so buttons stay locked until the next step is actually on screen.
 */
export function ProposalActions({ jobId, proposedName, title, perRunUsd, monthlyUsd, cadenceLabel, firstRunLabel, simulated }: ProposalActionsProps) {
  const router = useRouter();
  const [name, setName] = useState("");
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
        toast.success(`Proposal regenerated — ${proposedName} is still the best fit.`, {
          description: "Simulated mode designs deterministically. Edit the spec to change the design.",
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
      toast.success("Back to the spec. Approve it again to get a fresh proposal.");
      router.refresh();
    });
  }

  return (
    <Card className="lg:sticky lg:top-6" aria-busy={pending}>
      <CardHeader>
        <CardTitle>Hire {displayName}?</CardTitle>
        <CardDescription>{title}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-lg border bg-muted/40 p-2.5">
            <dt className="text-xs text-muted-foreground">Per run</dt>
            <dd className="font-semibold metric">{formatUsdPrecise(perRunUsd)}</dd>
          </div>
          <div className="rounded-lg border bg-muted/40 p-2.5">
            <dt className="text-xs text-muted-foreground">Per month</dt>
            <dd className="font-semibold metric">{formatUsd(monthlyUsd)}</dd>
          </div>
          <div className="col-span-2 rounded-lg border bg-muted/40 p-2.5">
            <dt className="text-xs text-muted-foreground">Schedule</dt>
            <dd className="font-medium">{cadenceLabel}</dd>
            <dd className="text-xs text-muted-foreground">{firstRunLabel}</dd>
          </div>
        </dl>

        <div className="space-y-2">
          <Label htmlFor="worker-name">Give them a different name (optional)</Label>
          <Input
            id="worker-name"
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
          {nameTooLong ? <p className="text-xs text-rose-600">Keep it under {WORKER_NAME_MAX_CHARS} characters.</p> : null}
        </div>

        {error ? (
          <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        <Button type="button" size="lg" className="w-full" onClick={hire} disabled={pending || nameTooLong}>
          {active === "hire" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Handshake aria-hidden="true" />}
          {active === "hire" ? `Hiring ${displayName}…` : `Hire ${displayName}`}
        </Button>
        <p className="text-center text-xs text-muted-foreground">Their first run starts right away. Pause, replace or retire them any time.</p>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-2">
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" size="sm" onClick={regenerate} disabled={pending}>
            {active === "regenerate" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
            {active === "regenerate" ? "Redesigning…" : "Regenerate proposal"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={backToSpec} disabled={pending}>
            {active === "revise" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ArrowLeft aria-hidden="true" />}
            {active === "revise" ? "Opening spec…" : "Back to spec"}
          </Button>
        </div>
        <div className="flex justify-center">
          <DiscardJobButton jobId={jobId} disabled={pending} />
        </div>
      </CardFooter>
    </Card>
  );
}
