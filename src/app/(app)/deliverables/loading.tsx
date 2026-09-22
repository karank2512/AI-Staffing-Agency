import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors /deliverables: title, stat strip, segmented filter, then a card of hairline rows. */
export default function DeliverablesLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading deliverables…</span>

      <div className="mb-10 space-y-3">
        <Skeleton className="h-4 w-24 rounded-sm" />
        <Skeleton className="h-8 w-52 rounded-sm" />
        <Skeleton className="h-5 w-96 max-w-full rounded-sm" />
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border shadow-card md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-3 bg-card p-6">
            <Skeleton className="h-3.5 w-24 rounded-sm" />
            <Skeleton className="h-8 w-14 rounded-sm" />
          </div>
        ))}
      </div>

      <Skeleton className="mt-14 h-8 w-[26rem] max-w-full rounded-full" />

      <div className="mt-6 overflow-hidden rounded-xl bg-card shadow-card">
        <div className="h-11 border-b border-border" />
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex h-16 items-center gap-6 px-6 not-last:border-b not-last:border-border">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-64 max-w-full rounded-sm" />
              <Skeleton className="h-3 w-44 max-w-full rounded-sm" />
            </div>
            <Skeleton className="hidden h-4 w-24 rounded-sm sm:block" />
            <Skeleton className="hidden h-4 w-10 rounded-sm sm:block" />
            <Skeleton className="hidden h-4 w-20 rounded-sm sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
