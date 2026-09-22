"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { proposeReplacementAction } from "../manage-actions";

export interface VersionsProposeCardProps {
  workerId: string;
  workerName: string;
  /** The worker can take a new proposal and the viewer is allowed to ask for one. */
  canPropose: boolean;
  mayManage: boolean;
  status: "ACTIVE" | "PAUSED" | "RETIRED";
  openProposal: { id: string; version: number; changeReason: "INITIAL_HIRE" | "REPLACEMENT" | "SPEC_CHANGE" | "MANUAL"; href: string } | null;
}

/** The "Replace" entry point — anchored so links from other tabs land on it. */
export function VersionsProposeCard({ workerId, workerName, canPropose, mayManage, status, openProposal }: VersionsProposeCardProps) {
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
    <Card id="replace" className="scroll-mt-32">
      <CardContent className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between sm:gap-10">
        <div className="min-w-0">
          <h2 className="text-title-2 text-balance">
            {openProposal ? `Version ${openProposal.version} is waiting for your decision` : `Not happy with ${workerName}'s work?`}
          </h2>
          <p className="text-body mt-2 max-w-[62ch] text-pretty text-muted-foreground">
            {openProposal
              ? `Nothing changes until you hire it or decline. ${workerName} keeps working the current way in the meantime.`
              : status === "RETIRED"
                ? `${workerName} is retired. Hire a new worker for this job instead.`
                : `Like any contractor, ${workerName} can be replaced. We read the last 30 days — failed runs, low scores, work you sent back — and design a version around what went wrong. You compare the two side by side before anything changes.`}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3">
          {pending ? (
            <p className="text-footnote text-muted-foreground" role="status" aria-live="polite">
              Reading 30 days of runs and drafting a stronger design…
            </p>
          ) : openProposal ? (
            <>
              {canPropose ? (
                <ConfirmDialog
                  trigger={<Button variant="ghost">Start over</Button>}
                  title="Draft a fresh proposal?"
                  description={`The open proposal for version ${openProposal.version} is declined and replaced by a new one based on ${workerName}'s latest runs.`}
                  confirmLabel="Draft a new one"
                  onConfirm={propose}
                />
              ) : null}
              <Button variant="secondary" asChild>
                <Link href={openProposal.href}>Compare and decide</Link>
              </Button>
            </>
          ) : mayManage ? (
            <Button variant="secondary" onClick={proposeFromButton} disabled={!canPropose}>
              Draft a replacement
            </Button>
          ) : (
            <p className="text-footnote max-w-[24ch] text-muted-foreground">
              Only workspace admins can propose a replacement.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
