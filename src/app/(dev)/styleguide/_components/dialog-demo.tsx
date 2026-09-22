"use client";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";

/** `onConfirm` is a function, so the demo has to live on the client side of the boundary. */
export function DialogDemo() {
  return (
    <ConfirmDialog
      trigger={<Button variant="destructive">Retire Maya</Button>}
      title="Retire Maya?"
      description="Queued runs are cancelled. Her history and deliverables stay on file."
      confirmLabel="Retire worker"
      destructive
      onConfirm={async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
      }}
    />
  );
}
