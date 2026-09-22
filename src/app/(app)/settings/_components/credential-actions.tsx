"use client";

import { useId, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { deleteCredentialAction, setCredentialAction } from "../actions";
import { CREDENTIAL_LABEL_MAX, CREDENTIAL_VALUE_MAX } from "../schema";

const MEMBER_HINT = "Only workspace owners and admins can manage tool credentials.";

export interface CredentialActionsProps {
  name: string;
  /** Human label of the key: "Tavily API key". */
  label: string;
  docsUrl: string;
  /** Display names of the tools this key powers, for the success toast. */
  usedBy: string[];
  /** True when the vault already holds a value (→ "Replace" + "Remove"). */
  stored: boolean;
  canManage: boolean;
}

/** Disabled buttons swallow pointer events, so the tooltip needs a wrapper to hang off. */
function Gated({ canManage, children }: { canManage: boolean; children: ReactNode }) {
  if (canManage) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{MEMBER_HINT}</TooltipContent>
    </Tooltip>
  );
}

/** "Add / Replace key" dialog + "Remove" confirmation for one credential row. The key is typed masked and never echoed. */
export function CredentialActions({ name, label, docsUrl, usedBy, stored, canManage }: CredentialActionsProps) {
  const router = useRouter();
  const ids = { value: useId(), label: useId() };
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const [pending, startTransition] = useTransition();
  const tools = usedBy.join(", ");

  function reset() {
    setValue("");
    setCustomLabel("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || value.trim() === "") return;
    startTransition(async () => {
      const r = await setCredentialAction({ name, value, label: customLabel || undefined });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(stored ? `${label} replaced` : `${label} saved`, {
        description: tools ? `${tools} will use it on the next run.` : undefined,
      });
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Gated canManage={canManage}>
        <Dialog
          open={open}
          onOpenChange={(next) => {
            if (pending) return;
            setOpen(next);
            if (!next) reset();
          }}
        >
          <DialogTrigger asChild>
            <Button variant={stored ? "outline" : "default"} size="sm" disabled={!canManage}>
              <KeyRound aria-hidden="true" />
              {stored ? "Replace key" : "Add key"}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md" showCloseButton={!pending}>
            <form onSubmit={submit} className="space-y-4">
              <DialogHeader>
                <DialogTitle>{stored ? `Replace ${label}` : `Add ${label}`}</DialogTitle>
                <DialogDescription>
                  Stored encrypted for this workspace and only ever read by {tools || "the tools that need it"}. It is never shown again —
                  not even to you.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor={ids.value}>Key</Label>
                  <Input
                    id={ids.value}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    autoFocus
                    required
                    maxLength={CREDENTIAL_VALUE_MAX}
                    placeholder="Paste the key"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    disabled={pending}
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    Get one at{" "}
                    <a href={docsUrl} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2">
                      {docsUrl.replace(/^https?:\/\//, "")}
                    </a>
                    .
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={ids.label}>
                    Label <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id={ids.label}
                    maxLength={CREDENTIAL_LABEL_MAX}
                    placeholder="e.g. Team key, rotated Sep 2026"
                    value={customLabel}
                    onChange={(e) => setCustomLabel(e.target.value)}
                    disabled={pending}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending || value.trim() === ""}>
                  {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                  {stored ? "Replace key" : "Save key"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </Gated>

      {stored ? (
        <Gated canManage={canManage}>
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="sm" disabled={!canManage} aria-label={`Remove ${label}`}>
                <Trash2 aria-hidden="true" />
                Remove
              </Button>
            }
            title={`Remove ${label}?`}
            description={
              tools
                ? `${tools} will fall back to the server's .env key if one is set, otherwise to Simulated results. You can add a key again any time.`
                : "You can add a key again any time."
            }
            confirmLabel="Remove key"
            destructive
            onConfirm={async () => {
              const r = await deleteCredentialAction(name);
              if (!r.ok) throw new Error(r.error);
              toast.success(`${label} removed`);
              router.refresh();
            }}
          />
        </Gated>
      ) : null}
    </div>
  );
}
