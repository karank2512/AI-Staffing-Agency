import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors /jobs/[jobId]: back link + title, local nav, stat strip, then the document beside its rail. */
export default function JobDetailLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading job…</span>

      <div className="mb-10 space-y-3">
        <Skeleton className="h-4 w-20 rounded-sm" />
        <Skeleton className="h-9 w-[28rem] max-w-full rounded-sm" />
        <Skeleton className="h-4 w-72 max-w-full rounded-sm" />
      </div>

      <Skeleton className="h-(--localnav-height) w-full rounded-sm" />

      <div className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border shadow-card md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-3 bg-card p-6">
            <Skeleton className="h-3.5 w-24 rounded-sm" />
            <Skeleton className="h-8 w-16 rounded-sm" />
          </div>
        ))}
      </div>

      <div className="mt-14 grid gap-6 lg:grid-cols-12 lg:gap-10">
        <div className="space-y-6 lg:col-span-8">
          <Skeleton className="h-6 w-48 rounded-sm" />
          <div className="space-y-4 rounded-xl bg-card p-9 shadow-card">
            <Skeleton className="h-6 w-72 max-w-full rounded-sm" />
            <Skeleton className="h-4 w-full rounded-sm" />
            <Skeleton className="h-4 w-11/12 rounded-sm" />
            <Skeleton className="h-4 w-4/5 rounded-sm" />
            <div className="pt-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="mt-3 h-4 w-2/3 rounded-sm" />
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-6 lg:col-span-4">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="space-y-4 rounded-xl bg-card p-6 shadow-card">
              <Skeleton className="h-5 w-40 rounded-sm" />
              {Array.from({ length: 3 }, (_, j) => (
                <div key={j} className="flex items-center gap-3">
                  <Skeleton className="size-8 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-28 rounded-sm" />
                    <Skeleton className="h-3 w-36 max-w-full rounded-sm" />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
