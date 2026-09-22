"use client";

import { useEffect } from "react";
import "./globals.css";

/**
 * Last-resort boundary: it replaces the root layout, so it owns its own <html>/<body> and cannot use anything
 * that depends on providers. Calm, on-brand, and never a stack trace — `digest` is the only reference a visitor
 * (or support) needs to find the real error in the server logs.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app] unrecoverable error", error.digest ?? error.message);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col items-center justify-center px-4 text-center">
          <h1 className="text-headline text-balance">Something went wrong on our side.</h1>
          <p className="text-body mt-3 text-muted-foreground">
            The page couldn&apos;t be loaded. Your workers, runs and deliverables are unaffected — trying again
            usually does it.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-5.5 text-[17px] font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover"
            >
              Try again
            </button>
            <a href="/workforce" className="text-[15px] font-medium text-link transition-opacity hover:opacity-70">
              Go to Workforce ›
            </a>
          </div>
          {error.digest ? (
            <p className="mt-8 font-mono text-caption text-tertiary">Reference {error.digest}</p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
