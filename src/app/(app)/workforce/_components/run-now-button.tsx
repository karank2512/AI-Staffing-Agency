"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { startRunAction } from "../actions";

export interface RunNowButtonProps {
  workerId: string;
  workerName: string;
  /** Disabled with a reason when the worker can't take new work right now, or the viewer can't start one. */
  disabledReason?: string;
}

/** Queues a manual run and confirms with a link to it. A small client leaf; the card around it stays a server component. */
export function RunNowButton({ workerId, workerName, disabledReason }: RunNowButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function run() {
    if (pending) return;
    setPending(true);
    try {
      const result = await startRunAction(workerId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${workerName} is on it`, {
        description: "The run is queued and starts in a moment.",
        action: (
          <Link href={`/runs/${result.data.runId}`} className="text-footnote font-medium text-link">
            Watch
          </Link>
        ),
      });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={run}
      disabled={pending || Boolean(disabledReason)}
      title={disabledReason}
      aria-label={`Run ${workerName} now`}
      className="max-sm:h-11 max-sm:px-5"
    >
      {pending ? "Starting…" : "Run now"}
    </Button>
  );
}
