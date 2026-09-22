import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors /activity: title → filter pills → one card per day of feed rows. Never a spinner. */
export default function ActivityLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading activity…</span>

      <div className="mb-10 space-y-3">
        <Skeleton className="h-8 w-40 rounded-sm" />
        <Skeleton className="h-5 w-96 max-w-full rounded-sm" />
      </div>

      <div className="space-y-8">
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-8 w-80 max-w-full rounded-full" />
          <Skeleton className="h-9 w-40 rounded-full" />
        </div>

        <div className="space-y-6">
          {[5, 3].map((rows, day) => (
            <div key={day} className="rounded-xl bg-card shadow-card">
              <div className="border-b border-border px-6 py-3">
                <Skeleton className="h-3.5 w-20 rounded-sm" />
              </div>
              <div className="divide-y divide-border px-6 pb-2">
                {Array.from({ length: rows }, (_, i) => (
                  <div key={i} className="flex min-h-14 items-start gap-3.5 py-3.5">
                    <Skeleton className="size-8 shrink-0 rounded-full" />
                    <div className="flex-1 space-y-2 pt-0.5">
                      <Skeleton className="h-4 w-80 max-w-full rounded-sm" />
                      <Skeleton className="h-3 w-56 max-w-full rounded-sm" />
                    </div>
                    <Skeleton className="h-3.5 w-16 shrink-0 rounded-sm" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
