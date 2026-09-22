import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors /jobs: title, segmented filter, then a card of hairline rows. */
export default function JobsLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading jobs…</span>

      <div className="mb-10 space-y-3">
        <Skeleton className="h-8 w-32 rounded-sm" />
        <Skeleton className="h-5 w-96 max-w-full rounded-sm" />
      </div>

      <Skeleton className="h-8 w-80 max-w-full rounded-full" />

      <div className="mt-6 overflow-hidden rounded-xl bg-card shadow-card">
        <div className="h-11 border-b border-border" />
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex h-16 items-center gap-6 px-6 not-last:border-b not-last:border-border">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-56 max-w-full rounded-sm" />
              <Skeleton className="h-3 w-40 max-w-full rounded-sm" />
            </div>
            <Skeleton className="hidden h-4 w-24 rounded-sm sm:block" />
            <Skeleton className="hidden h-4 w-20 rounded-sm sm:block" />
            <Skeleton className="hidden h-4 w-16 rounded-sm sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
