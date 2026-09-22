"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { proposeWorkerAction } from "../actions";
import { designNarrative } from "../schema";
import { DesigningPanel } from "./designing-panel";
import { DiscardJobLink } from "./discard-job-button";

/**
 * Shown when the flow is on the proposal step but no proposal is stored yet (a resumed flow, or the "approve"
 * round-trip was interrupted). Designs the worker on mount, then refreshes so the server renders the résumé.
 */
export function ProposalPending({ jobId, specTitle, canManage }: { jobId: string; specTitle: string; canManage: boolean }) {
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
        <CardContent className="flex flex-col items-center gap-5 py-14 text-center">
          <div className="space-y-2.5">
            <h2 className="text-title-2 text-balance">We couldn&apos;t design the worker</h2>
            <p role="alert" className="mx-auto max-w-[44ch] text-body text-pretty text-muted-foreground">
              {error}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Button type="button" size="lg" onClick={design} disabled={pending || !canManage}>
              {pending ? "Trying again…" : "Try again"}
            </Button>
            {canManage ? <DiscardJobLink jobId={jobId} disabled={pending} /> : null}
          </div>
        </CardContent>
      </Card>
    );
  }

  return <DesigningPanel lines={designNarrative(specTitle)} />;
}
