"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TONE_CLASSES } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { ToolGrantView } from "@/server/queries/worker-manage";
import { updateToolGrantAction } from "../manage-actions";

const CATEGORY_LABELS: Record<string, string> = {
  research: "Research",
  data: "Data",
  output: "Output",
  compute: "Compute",
  communication: "Communication",
};

/** Side effects in a manager's words; external writes get the attention colour because they leave the building. */
const SIDE_EFFECT_META: Record<string, { label: string; tone: keyof typeof TONE_CLASSES }> = {
  none: { label: "No side effects", tone: "idle" },
  external_read: { label: "Reads the web", tone: "running" },
  external_write: { label: "Sends externally", tone: "attention" },
};

export interface PermissionsGrantsTableProps {
  workerId: string;
  workerName: string;
  grants: ToolGrantView[];
  /** Retired workers keep their history but nothing can change. */
  readOnly: boolean;
}

export function PermissionsGrantsTable({ workerId, workerName, grants, readOnly }: PermissionsGrantsTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[46%]">Tool</TableHead>
          <TableHead>Why {workerName} needs it</TableHead>
          <TableHead className="w-36 text-center">Requires approval</TableHead>
          <TableHead className="w-28 text-right">Access</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {grants.map((grant) => (
          <GrantRow key={grant.toolName} workerId={workerId} workerName={workerName} grant={grant} readOnly={readOnly} />
        ))}
      </TableBody>
    </Table>
  );
}

function GrantRow({ workerId, workerName, grant, readOnly }: { workerId: string; workerName: string; grant: ToolGrantView; readOnly: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Optimistic: the switch flips immediately and snaps back if the server refuses.
  const [requiresApproval, setRequiresApproval] = useState(grant.requiresApproval);
  const locked = grant.defaultRequiresApproval;
  const sideEffect = grant.sideEffect ? SIDE_EFFECT_META[grant.sideEffect] : null;
  const disabled = readOnly || grant.revoked || pending;

  function toggleApproval(next: boolean) {
    if (locked && !next) return;
    const previous = requiresApproval;
    setRequiresApproval(next);
    startTransition(async () => {
      const r = await updateToolGrantAction(workerId, grant.toolName, { requiresApproval: next });
      if (!r.ok) {
        setRequiresApproval(previous);
        toast.error(r.error);
        return;
      }
      toast.success(next ? `${workerName} will ask before using ${grant.displayName}` : `${workerName} can use ${grant.displayName} without asking`);
      router.refresh();
    });
  }

  async function setRevoked(revoked: boolean) {
    const r = await updateToolGrantAction(workerId, grant.toolName, { revoked });
    if (!r.ok) throw new Error(r.error);
    toast.success(revoked ? `${workerName} can no longer use ${grant.displayName}` : `${grant.displayName} restored for ${workerName}`);
    router.refresh();
  }

  return (
    <TableRow className={cn(grant.revoked && "bg-muted/30")}>
      <TableCell className="align-top">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn("font-medium", grant.revoked && "text-muted-foreground line-through decoration-muted-foreground/50")}>{grant.displayName}</span>
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-muted-foreground">{grant.toolName}</code>
          </div>
          {grant.humanDescription ? <p className="text-xs text-pretty text-muted-foreground">{grant.humanDescription}</p> : null}
          <div className="flex flex-wrap gap-1 pt-0.5">
            {grant.category ? (
              <Badge variant="outline" className="text-[11px]">
                {CATEGORY_LABELS[grant.category] ?? grant.category}
              </Badge>
            ) : null}
            {sideEffect ? <Badge className={cn("text-[11px]", TONE_CLASSES[sideEffect.tone].badge)}>{sideEffect.label}</Badge> : null}
            {grant.maxCallsPerRun !== null ? (
              <Badge variant="outline" className="text-[11px] tabular-nums">
                ≤ {grant.maxCallsPerRun} calls / run
              </Badge>
            ) : null}
          </div>
        </div>
      </TableCell>
      <TableCell className="align-top">
        {grant.reason ? (
          <p className="text-[13px] text-pretty text-muted-foreground">{grant.reason}</p>
        ) : (
          <p className="text-xs text-muted-foreground italic">Not part of the current design.</p>
        )}
      </TableCell>
      <TableCell className="align-top text-center">
        <div className="inline-flex items-center gap-2">
          <Switch
            checked={requiresApproval}
            disabled={disabled || (locked && requiresApproval)}
            onCheckedChange={toggleApproval}
            aria-label={`${grant.displayName} requires approval`}
          />
          {locked ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex" aria-label="Always requires approval">
                  <Lock className="size-3.5 text-muted-foreground" aria-hidden="true" />
                </span>
              </TooltipTrigger>
              <TooltipContent>{grant.displayName} always requires your approval.</TooltipContent>
            </Tooltip>
          ) : pending ? (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : null}
        </div>
      </TableCell>
      <TableCell className="align-top text-right">
        {readOnly ? (
          <span className="text-xs text-muted-foreground">{grant.revoked ? "Revoked" : "Granted"}</span>
        ) : grant.revoked ? (
          <ConfirmDialog
            trigger={
              <Button variant="outline" size="sm">
                Restore
              </Button>
            }
            title={`Restore ${grant.displayName} for ${workerName}?`}
            description={`${workerName} will be able to use ${grant.displayName} again on the next run${grant.requiresApproval ? ", with your approval each time" : ""}.`}
            confirmLabel="Restore access"
            onConfirm={() => setRevoked(false)}
          />
        ) : (
          <ConfirmDialog
            trigger={
              <Button variant="destructive" size="sm">
                Revoke
              </Button>
            }
            title={`Revoke ${grant.displayName} from ${workerName}?`}
            description={
              <>
                Every future call to {grant.displayName} is refused. {workerName} will try to finish the job without it, which may lower
                the quality of deliverables. You can restore it any time.
              </>
            }
            confirmLabel="Revoke access"
            destructive
            onConfirm={() => setRevoked(true)}
          />
        )}
      </TableCell>
    </TableRow>
  );
}
