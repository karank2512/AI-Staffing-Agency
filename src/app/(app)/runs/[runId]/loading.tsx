import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors /runs/[runId]: back link + title + meta, local nav, then the timeline beside its facts rail. */
export default function RunDetailLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading run…</span>

      <div className="mb-10 space-y-3">
        <Skeleton className="h-4 w-20 rounded-sm" />
        <Skeleton className="h-9 w-96 max-w-full rounded-sm" />
        <Skeleton className="h-4 w-72 max-w-full rounded-sm" />
        <Skeleton className="h-4 w-56 max-w-full rounded-sm" />
      </div>

      <Skeleton className="h-(--localnav-height) w-full rounded-sm" />

      <div className="mt-10 grid gap-6 lg:grid-cols-12 lg:gap-10">
        <div className="space-y-6 lg:col-span-8">
          <Skeleton className="h-6 w-44 rounded-sm" />
          <div className="rounded-xl bg-card p-6 shadow-card">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex gap-4 pb-6 last:pb-0">
                <Skeleton className="mt-1.5 size-[9px] shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4 max-w-full rounded-sm" />
                  <Skeleton className="h-3 w-1/2 max-w-full rounded-sm" />
                </div>
                <Skeleton className="h-3 w-12 shrink-0 rounded-sm" />
              </div>
            ))}
          </div>
        </div>
        <div className="lg:col-span-4">
          <div className="space-y-3 rounded-xl bg-card p-6 shadow-card">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex items-center justify-between gap-6">
                <Skeleton className="h-3.5 w-24 rounded-sm" />
                <Skeleton className="h-3.5 w-20 rounded-sm" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
