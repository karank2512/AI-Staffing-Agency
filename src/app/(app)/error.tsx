"use client";

import { useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Error boundary for every (app) route. The shell (sidebar) stays mounted; only the page area is replaced. */
export default function AppErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();

  useEffect(() => {
    console.error("[app] page error", error);
  }, [error]);

  function retry() {
    // refresh() re-fetches the server components; reset() alone would re-render the same failed payload.
    startRetry(() => {
      router.refresh();
      reset();
    });
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex max-w-md flex-col items-center text-center">
        <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-rose-50 text-rose-600 ring-1 ring-rose-200 ring-inset">
          <TriangleAlert className="size-5" aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold tracking-tight">This page hit a snag</h1>
        <p className="mt-1.5 text-sm text-pretty text-muted-foreground">
          Something went wrong while loading it. Your workers and their data are unaffected — trying again usually
          does the trick.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button onClick={retry} disabled={retrying}>
            {retrying ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RotateCw aria-hidden="true" />}
            Try again
          </Button>
          <Button variant="outline" asChild>
            <Link href="/workforce">Back to Workforce</Link>
          </Button>
        </div>
        {error.digest ? (
          <p className="mt-5 font-mono text-[11px] text-muted-foreground/70">Reference: {error.digest}</p>
        ) : null}
      </div>
    </div>
  );
}
