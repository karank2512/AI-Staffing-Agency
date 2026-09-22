import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Rendered when an (app) page calls `notFound()` — typically an id that does not exist in the caller's
 * organization. Deliberately does not distinguish "missing" from "someone else's" (multi-tenancy).
 */
export default function AppNotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex max-w-md flex-col items-center text-center">
        <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground ring-1 ring-foreground/10 ring-inset">
          <Compass className="size-5" aria-hidden="true" />
        </div>
        <p className="eyebrow">404</p>
        <h1 className="mt-1 text-lg font-semibold tracking-tight">We couldn&apos;t find that</h1>
        <p className="mt-1.5 text-sm text-pretty text-muted-foreground">
          It may have been removed, or the link points to something outside your workspace.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button asChild>
            <Link href="/workforce">Go to Workforce</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/activity">View activity</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
