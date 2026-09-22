import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Rendered when an (app) page calls `notFound()` — typically an id that does not exist in the caller's
 * organization. Deliberately does not distinguish "missing" from "someone else's" (multi-tenancy).
 */
export default function AppNotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <h1 className="text-title-2 text-balance">We couldn&apos;t find that page.</h1>
      <p className="text-body mt-3 max-w-[44ch] text-muted-foreground">
        It may have been removed, or the link points to something outside your workspace.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button size="lg" asChild>
          <Link href="/workforce">Go to Workforce</Link>
        </Button>
        <Button variant="link" asChild>
          <Link href="/activity">View activity ›</Link>
        </Button>
      </div>
    </div>
  );
}
