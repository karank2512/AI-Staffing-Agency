import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found" };

/**
 * Root 404 — served for URLs outside any route group (and for `notFound()` on public pages). Deliberately says
 * nothing about whether the thing exists for someone else.
 */
export default function RootNotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col items-center justify-center px-4 text-center">
      <h1 className="text-headline text-balance">We couldn&apos;t find that page.</h1>
      <p className="text-body mt-3 text-muted-foreground">
        The link may be out of date, or the page may have moved.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/workforce"
          className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-5.5 text-[17px] font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover"
        >
          Go to Workforce
        </Link>
        <Link href="/sign-in" className="text-[15px] font-medium text-link transition-opacity hover:opacity-70">
          Sign in ›
        </Link>
      </div>
    </main>
  );
}
