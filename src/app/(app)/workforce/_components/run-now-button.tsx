"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { startRunAction } from "../actions";

export interface RunNowButtonProps {
  workerId: string;
  workerName: string;
  /** Disabled with a reason when the worker cannot take new work right now. */
  disabledReason?: string;
}

/** Queues a manual run and confirms with a link to it. Small client leaf; the card around it stays a server component. */
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
        description: "The run is queued and will start in a moment.",
        action: <Link href={`/runs/${result.data.runId}`} className="text-xs font-medium underline underline-offset-2">Watch it</Link>,
      });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={run}
      disabled={pending || Boolean(disabledReason)}
      title={disabledReason}
      aria-label={`Run ${workerName} now`}
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Play aria-hidden="true" />}
      Run now
    </Button>
  );
}
