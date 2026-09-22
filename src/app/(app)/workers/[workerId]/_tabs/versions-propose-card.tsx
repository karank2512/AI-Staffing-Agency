"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { proposeReplacementAction } from "../manage-actions";

export interface VersionsProposeCardProps {
  workerId: string;
  workerName: string;
  canPropose: boolean;
  status: "ACTIVE" | "PAUSED" | "RETIRED";
  openProposal: { id: string; version: number; changeReason: "INITIAL_HIRE" | "REPLACEMENT" | "SPEC_CHANGE" | "MANUAL"; href: string } | null;
}

const STEPS = [
  { title: "Review the record", detail: "Failed runs, low scores and rejected deliverables from the last 30 days." },
  { title: "Design a better fit", detail: "Sharper instructions, a stronger model where it matters, and cleaning steps." },
  { title: "You decide", detail: "Compare side by side, then hire the replacement or keep the current one." },
];

/** The "Replace" entry point — anchored so links from other tabs land on it. */
export function VersionsProposeCard({ workerId, workerName, canPropose, status, openProposal }: VersionsProposeCardProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  /** Throws on failure so ConfirmDialog can keep itself open; the plain button toasts the message instead. */
  async function propose(): Promise<void> {
    if (pending) return;
    setPending(true);
    const r = await proposeReplacementAction(workerId);
    if (!r.ok) {
      setPending(false);
      throw new Error(r.error);
    }
    toast.success(`A replacement for ${workerName} is ready to review`);
    router.push(r.data.redirectTo);
  }

  function proposeFromButton() {
    propose().catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Something went wrong. Please try again."));
  }

  return (
    <Card id="replace" className="scroll-mt-24 border-primary/15 bg-gradient-to-br from-primary/[0.04] to-transparent">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="size-4 text-primary" aria-hidden="true" />
          Propose a replacement
        </CardTitle>
        <CardDescription>
          Not happy with {workerName}&apos;s work? Like any contractor, they can be replaced — by a version designed around what went
          wrong.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <ol className="grid gap-3 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="rounded-lg border bg-card/80 p-3">
              <p className="text-xs font-medium text-muted-foreground">Step {i + 1}</p>
              <p className="mt-0.5 text-sm font-medium">{step.title}</p>
              <p className="mt-1 text-xs text-pretty text-muted-foreground">{step.detail}</p>
            </li>
          ))}
        </ol>

        {pending ? (
          <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm" role="status" aria-live="polite">
            <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
            <div>
              <p className="font-medium">Analyzing 30 days of runs…</p>
              <p className="text-xs text-muted-foreground">Reading evaluations and feedback, then drafting a stronger design. This takes a moment.</p>
            </div>
          </div>
        ) : openProposal ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
            <p className="text-sm text-amber-900">
              <span className="font-medium">Version {openProposal.version} is waiting for your decision.</span>{" "}
              <span className="text-amber-800/80">Nothing changes until you hire it or decline.</span>
            </p>
            <div className="flex items-center gap-2">
              {canPropose ? (
                <ConfirmDialog
                  trigger={
                    <Button variant="ghost" size="sm">
                      Start over
                    </Button>
                  }
                  title="Run a fresh analysis?"
                  description={`The open proposal for version ${openProposal.version} will be declined and replaced by a new one based on ${workerName}'s latest runs.`}
                  confirmLabel="Analyze again"
                  onConfirm={propose}
                />
              ) : null}
              <Button size="sm" asChild>
                <Link href={openProposal.href}>
                  Review &amp; decide <ArrowUpRight aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {status === "RETIRED"
                ? `${workerName} is retired. Hire a new worker for this job instead.`
                : `The current version keeps working until you hire the replacement.`}
            </p>
            <Button onClick={proposeFromButton} disabled={!canPropose}>
              <Sparkles aria-hidden="true" /> Propose a replacement
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
