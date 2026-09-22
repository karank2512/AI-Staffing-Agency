"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2, UserCheck, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
  workerStatus: "ACTIVE" | "PAUSED" | "RETIRED";
}

/** The decision: hire the replacement / apply the change, or decline. Everything else on the page is evidence. */
export function ReplaceDecision({ workerId, workerName, versionId, version, changeReason, status, canDecide, workerStatus }: ReplaceDecisionProps) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [startFirstRun, setStartFirstRun] = useState(true);
  const [pending, setPending] = useState(false);

  const isReplacement = changeReason === "REPLACEMENT";
  const ctaLabel = isReplacement ? "Hire replacement" : "Apply change";
  const Icon = isReplacement ? UserCheck : Wand2;

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
    toast.success(isReplacement ? `${finalName} is hired — version ${version} is now active` : `${finalName} now works the new way`, {
      description: r.data.firstRunQueued ? "The first run is starting." : workerStatus === "PAUSED" ? "Resume the worker to start the first run." : undefined,
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
      <Card>
        <CardHeader>
          <CardTitle>{status === "ACTIVE" ? "Decision made" : status === "REPLACED" ? "Superseded" : "Declined"}</CardTitle>
          <CardDescription>
            {status === "ACTIVE"
              ? `Version ${version} is the one ${workerName} works under today.`
              : status === "REPLACED"
                ? `Version ${version} was active for a while and has since been replaced.`
                : `This proposal was declined; ${workerName} kept working as before.`}
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href={`/workers/${workerId}?tab=versions`}>All versions</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/workers/${workerId}`}>Back to {workerName}</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="border-primary/25 ring-primary/15">
      <CardHeader>
        <CardTitle>{isReplacement ? "Your decision" : "Apply this change?"}</CardTitle>
        <CardDescription>
          {isReplacement
            ? `The current ${workerName} keeps working until you hire the replacement. History, deliverables and permissions carry over.`
            : `${workerName} keeps the same name and history — only the design changes. Permissions you tightened stay tightened.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isReplacement ? (
          <div className="space-y-1.5">
            <Label htmlFor="replacement-name">New name (optional)</Label>
            <Input
              id="replacement-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={WORKER_NAME_MAX_CHARS}
              placeholder={`Keep “${workerName}”`}
              disabled={pending}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">A new name makes the change visible to the team; leave it blank to keep continuity.</p>
          </div>
        ) : null}
        <div className="flex items-start gap-2.5">
          <Checkbox id="start-first-run" checked={startFirstRun} onCheckedChange={(v) => setStartFirstRun(v === true)} disabled={pending} className="mt-0.5" />
          <div className="space-y-0.5">
            <Label htmlFor="start-first-run" className="font-normal">
              Start the first run right away
            </Label>
            <p className="text-xs text-muted-foreground">
              {workerStatus === "PAUSED" ? `${workerName} is paused, so the run waits until you resume.` : "Otherwise the next scheduled run picks up the new version."}
            </p>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap items-center gap-2">
        <Button onClick={hire} disabled={pending} className="min-w-40">
          {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Icon aria-hidden="true" />}
          {pending ? (isReplacement ? "Hiring…" : "Applying…") : ctaLabel}
        </Button>
        <ConfirmDialog
          trigger={
            <Button variant="ghost" disabled={pending}>
              Decline
            </Button>
          }
          title={isReplacement ? `Keep the current ${workerName}?` : "Decline this change?"}
          description={
            isReplacement
              ? `The proposed replacement is declined and ${workerName} continues as is. You can propose another replacement any time.`
              : `${workerName} keeps working the current way. You can ask for the change again in chat.`
          }
          confirmLabel={isReplacement ? "Keep current version" : "Decline change"}
          destructive
          onConfirm={decline}
        />
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Check className="size-3" aria-hidden="true" /> Reversible — every version stays in history
        </span>
      </CardFooter>
    </Card>
  );
}
