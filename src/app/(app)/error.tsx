"use client";

import { useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/** Error boundary for every (app) route. The chrome stays mounted; only the page area is replaced. */
export default function AppErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();

  useEffect(() => {
    console.error("[app] page error", error.digest ?? error.message);
  }, [error]);

  function retry() {
    // refresh() re-fetches the server components; reset() alone would re-render the same failed payload.
    startRetry(() => {
      router.refresh();
      reset();
    });
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <h1 className="text-title-2 text-balance">Something went wrong on our side.</h1>
      <p className="text-body mt-3 max-w-[44ch] text-muted-foreground">
        This page couldn&apos;t be loaded. Your workers, runs and deliverables are unaffected — trying again
        usually does it.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button size="lg" onClick={retry} disabled={retrying}>
          {retrying ? "Trying again…" : "Try again"}
        </Button>
        <Button variant="link" asChild>
          <Link href="/workforce">Go to Workforce ›</Link>
        </Button>
      </div>
      {error.digest ? <p className="mt-8 font-mono text-caption text-tertiary">Reference {error.digest}</p> : null}
    </div>
  );
}
