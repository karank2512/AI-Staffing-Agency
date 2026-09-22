"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hireReplacementAction, rejectProposedVersionAction } from "../../../manage-actions";

const WORKER_NAME_MAX_CHARS = 40;

export interface ReplaceDecisionProps {
  workerId: string;
  workerName: string;
  versionId: string;
  version: number;
  changeReason: "INITIAL_HIRE" | "REPLACEMENT" | "SPEC_CHANGE" | "MANUAL";
  status: "PROPOSED" | "ACTIVE" | "REPLACED" | "REJECTED";
  canDecide: boolean;
  /** `workers.hire` — hiring the replacement. */
  mayHire: boolean;
  /** `workers.manage` — declining the proposal. */
  mayManage: boolean;
  workerStatus: "ACTIVE" | "PAUSED" | "RETIRED";
}

/**
 * The decision, in a sticky bottom bar: one primary pill to hire, one gray pill to keep things as they are.
 * Everything else on the page is evidence for it.
 */
export function ReplaceDecision({
  workerId,
  workerName,
  versionId,
  version,
  changeReason,
  status,
  canDecide,
  mayHire,
  mayManage,
  workerStatus,
}: ReplaceDecisionProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [startFirstRun, setStartFirstRun] = useState(true);
  const [pending, setPending] = useState(false);

  const isReplacement = changeReason === "REPLACEMENT";
  const ctaLabel = isReplacement ? "Hire replacement" : "Apply change";

  async function hire() {
    if (pending) return;
    setPending(true);
    const name = newName.trim();
    const r = await hireReplacementAction(workerId, versionId, { ...(name ? { newName: name } : {}), startFirstRun });
    if (!r.ok) {
      setPending(false);
      toast.error(r.error);
      return;
    }
    const finalName = name || workerName;
    toast.success(isReplacement ? `${finalName} is hired — version ${version} is now live` : `${finalName} now works the new way`, {
      description: r.data.firstRunQueued
        ? "The first run is starting."
        : workerStatus === "PAUSED"
          ? "Resume the worker to start the first run."
          : undefined,
    });
    router.push(r.data.redirectTo);
  }

  async function decline() {
    const r = await rejectProposedVersionAction(workerId, versionId);
    if (!r.ok) throw new Error(r.error);
    toast.success(isReplacement ? `Kept the current ${workerName}` : "Change declined");
    router.push(r.data.redirectTo);
  }

  if (!canDecide) {
    return (
      <div className="ml-[calc(50%-50vw)] w-dvw">
        <div className="material-thick shadow-bar">
          <div className="mx-auto flex w-full max-w-(--container-app) flex-wrap items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
            <p className="text-footnote min-w-0 text-muted-foreground">
              {status === "ACTIVE"
                ? `Version ${version} is what ${workerName} works under today.`
                : status === "REPLACED"
                  ? `Version ${version} was live for a while and has since been replaced.`
                  : `This proposal was declined; ${workerName} kept working as before.`}
            </p>
            <div className="flex shrink-0 items-center gap-2.5">
              <Button variant="secondary" asChild>
                <Link href={`/workers/${workerId}?tab=versions`}>All versions</Link>
              </Button>
              <Button variant="secondary" asChild>
                <Link href={`/workers/${workerId}`}>Back to {workerName}</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sticky bottom-0 z-30 ml-[calc(50%-50vw)] w-dvw">
      <div className="material-thick shadow-bar">
        <div className="mx-auto flex w-full max-w-(--container-app) flex-wrap items-center justify-between gap-3 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-6">
          <p className="text-footnote hidden min-w-0 text-muted-foreground sm:block">
            {mayHire
              ? isReplacement
                ? `Nothing changes until you hire. ${workerName} keeps working in the meantime.`
                : `${workerName} keeps the same name and history — only the design changes.`
              : "Only workspace admins can decide on a proposal."}
          </p>
          <div className="flex w-full items-center gap-3 sm:w-auto">
            {mayManage ? (
              <ConfirmDialog
                trigger={
                  <Button variant="secondary" disabled={pending} className="max-sm:h-11 max-sm:flex-1">
                    {isReplacement ? "Keep current" : "Decline"}
                  </Button>
                }
                title={isReplacement ? `Keep the current ${workerName}?` : "Decline this change?"}
                description={
                  isReplacement
                    ? `The proposed replacement is declined and ${workerName} carries on as is. You can ask for another one any time.`
                    : `${workerName} keeps working the current way. You can ask for the change again in chat.`
                }
                confirmLabel={isReplacement ? "Keep current version" : "Decline change"}
                destructive
                onConfirm={decline}
              />
            ) : null}
            <Button
              disabled={pending || !mayHire}
              onClick={() => setOpen(true)}
              className="max-sm:h-11 max-sm:flex-1 max-sm:text-[15px]"
            >
              {ctaLabel}
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={open} onOpenChange={(next) => (pending ? undefined : setOpen(next))}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isReplacement ? `Hire version ${version}?` : `Apply version ${version}?`}</DialogTitle>
            <DialogDescription>
              {isReplacement
                ? `Version ${version} takes over from now on. ${workerName}'s history, deliverables and permissions carry over, and the old version stays on file.`
                : `${workerName} starts working the new way from the next run. Permissions you tightened stay tightened.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {isReplacement ? (
              <div className="space-y-1.5">
                <Label htmlFor="replacement-name">A new name (optional)</Label>
                <Input
                  id="replacement-name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={WORKER_NAME_MAX_CHARS}
                  placeholder={`Keep “${workerName}”`}
                  disabled={pending}
                  autoComplete="off"
                />
                <p className="text-footnote text-muted-foreground">
                  A new name makes the change visible to the team; leave it blank to keep continuity.
                </p>
              </div>
            ) : null}

            <div className="flex items-start gap-3">
              <Checkbox
                id="start-first-run"
                checked={startFirstRun}
                onCheckedChange={(v) => setStartFirstRun(v === true)}
                disabled={pending}
                className="mt-0.5"
              />
              <div>
                <Label htmlFor="start-first-run" className="font-normal">
                  Start the first run right away
                </Label>
                <p className="text-footnote mt-0.5 text-muted-foreground">
                  {workerStatus === "PAUSED"
                    ? `${workerName} is paused, so the run waits until you resume.`
                    : "Otherwise the next scheduled run picks up the new version."}
                </p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={pending} onClick={hire}>
              {pending ? (isReplacement ? "Hiring…" : "Applying…") : ctaLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
