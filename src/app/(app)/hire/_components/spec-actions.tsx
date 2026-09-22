"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, UserRoundCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { approveSpecAndProposeAction } from "../actions";
import { DiscardJobButton } from "./discard-job-button";

const DESIGN_PHASES = ["Approving the spec", "Designing your worker", "Estimating cost and KPIs"] as const;

/**
 * Footer of the Job spec step. "Approve spec" approves and designs the worker in one round-trip; while that runs
 * the customer sees a "Designing your worker…" panel rather than a frozen button. The phases are cosmetic — the
 * server does the real work in one call and the page re-renders on the proposal step when it returns.
 */
export function SpecActions({ jobId, jobSpecId, specTitle }: { jobId: string; jobSpecId: string; specTitle: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!pending) {
      setPhase(0);
      return;
    }
    const timer = setInterval(() => setPhase((p) => Math.min(p + 1, DESIGN_PHASES.length - 1)), 1400);
    return () => clearInterval(timer);
  }, [pending]);

  function approve() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const result = await approveSpecAndProposeAction(jobId, jobSpecId);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        // The approval may have committed before the design failed; let the server re-derive the step
        // (the proposal step's pending panel offers a retry) instead of leaving a stale spec view.
        router.refresh();
        return;
      }
      toast.success(`Spec approved. Meet ${result.data.workerName}, your proposed hire.`);
      router.refresh();
    });
  }

  if (pending) {
    return (
      <Card aria-live="polite" aria-busy="true">
        <CardContent className="flex flex-col items-center gap-4 py-6 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/20">
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          </div>
          <div>
            <p className="text-base font-semibold tracking-tight">Designing your worker…</p>
            <p className="mt-1 text-sm text-muted-foreground">Picking the right pipeline, tools and safeguards for “{specTitle}”.</p>
          </div>
          <ol className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-[13px]">
            {DESIGN_PHASES.map((label, i) => {
              const done = i < phase;
              const active = i === phase;
              return (
                <li key={label} className={cn("flex items-center gap-1.5", done && "text-emerald-600", active && "text-foreground", !done && !active && "text-muted-foreground")}>
                  {done ? <Check className="size-3.5" aria-hidden="true" /> : active ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <span className="size-3.5" aria-hidden="true" />}
                  {label}
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <DiscardJobButton jobId={jobId} />
          <p className="text-xs text-muted-foreground">Approving locks this version of the spec. You can still come back and revise it before hiring.</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Button type="button" onClick={approve}>
            <UserRoundCheck aria-hidden="true" />
            Approve spec
          </Button>
          {error ? (
            <p role="alert" className="text-xs text-rose-600">
              {error}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
