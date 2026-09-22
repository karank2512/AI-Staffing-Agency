"use client";

import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export interface ConfirmDialogProps {
  /** The element that opens the dialog — usually a `<Button>`. Must accept a ref + onClick (any DOM element or shadcn Button). */
  trigger: ReactNode;
  /** The question, phrased as the action: "Retire Alex?" */
  title: string;
  /** Consequences in one or two sentences. */
  description: ReactNode;
  /** Verb on the confirm button: "Retire worker". */
  confirmLabel: string;
  /** Style the confirm button as destructive (retire, reject, cancel run, delete credential). */
  destructive?: boolean;
  /**
   * Runs on confirm. Resolve → the dialog closes. Throw → the message is toasted and the dialog stays open.
   * Server actions return `ActionResult` instead of throwing, so convert:
   * `onConfirm={async () => { const r = await retireAction(id); if (!r.ok) throw new Error(r.error); }}`
   */
  onConfirm: () => Promise<void>;
}

/** Confirmation step for consequential actions. Owns the pending state and error toast so callers stay small. */
export function ConfirmDialog({ trigger, title, description, confirmLabel, destructive, onConfirm }: ConfirmDialogProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function confirm() {
    if (pending) return;
    setPending(true);
    try {
      await onConfirm();
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    // While the action is in flight the dialog cannot be dismissed (Esc, overlay, Cancel) — the outcome must land.
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : setOpen(next))}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div className="text-[15px] text-pretty text-muted-foreground">{description}</div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="secondary" disabled={pending} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          {/* The final confirm is the one place a solid red pill is allowed — everywhere else danger is text. */}
          <Button
            type="button"
            disabled={pending}
            onClick={confirm}
            className={
              destructive ? "bg-danger text-white hover:bg-danger/90 focus-visible:ring-danger/25" : undefined
            }
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
