"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { proposeWorkerAction } from "../actions";
import { DiscardJobButton } from "./discard-job-button";

/**
 * Shown when the flow is on the proposal step but no proposal is stored yet (a resumed flow, or the "Approve"
 * round-trip was interrupted). Designs the worker on mount, then refreshes so the server renders the proposal.
 */
export function ProposalPending({ jobId, specTitle }: { jobId: string; specTitle: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const started = useRef(false);

  function design() {
    setError(null);
    startTransition(async () => {
      const result = await proposeWorkerAction(jobId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  useEffect(() => {
    // React Strict Mode mounts twice in development; the ref keeps this at one design call.
    if (started.current) return;
    started.current = true;
    design();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-rose-50 text-rose-600 ring-1 ring-rose-200 ring-inset">
            <TriangleAlert className="size-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-base font-semibold tracking-tight">We couldn&apos;t design the worker</p>
            <p role="alert" className="mt-1 max-w-md text-sm text-pretty text-muted-foreground">
              {error}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button type="button" onClick={design} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RotateCw aria-hidden="true" />}
              Try again
            </Button>
            <DiscardJobButton jobId={jobId} />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card aria-live="polite" aria-busy="true">
      <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/20">
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        </div>
        <div>
          <p className="text-base font-semibold tracking-tight">Designing your worker…</p>
          <p className="mt-1 text-sm text-muted-foreground">Picking the right pipeline, tools and safeguards for “{specTitle}”.</p>
        </div>
      </CardContent>
    </Card>
  );
}
