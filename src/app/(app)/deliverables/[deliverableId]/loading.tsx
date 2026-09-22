import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors /deliverables/[id]: back link + title + meta, then the article beside the review rail. */
export default function DeliverableLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading deliverable…</span>

      <div className="mb-10 space-y-3">
        <Skeleton className="h-4 w-28 rounded-sm" />
        <Skeleton className="h-9 w-[32rem] max-w-full rounded-sm" />
        <Skeleton className="h-4 w-80 max-w-full rounded-sm" />
      </div>

      <div className="grid gap-6 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-8">
          <div className="rounded-xl bg-card px-6 py-10 shadow-card sm:py-14">
            <div className="mx-auto w-full max-w-[692px] space-y-4">
              <Skeleton className="h-7 w-2/3 rounded-sm" />
              {Array.from({ length: 10 }, (_, i) => (
                <Skeleton key={i} className={i % 4 === 3 ? "h-4 w-3/5 rounded-sm" : "h-4 w-full rounded-sm"} />
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-6 lg:col-span-4">
          <div className="space-y-4 rounded-xl bg-card p-6 shadow-card">
            <Skeleton className="h-5 w-40 rounded-sm" />
            <Skeleton className="h-28 w-full rounded-lg" />
            <div className="flex gap-3">
              <Skeleton className="h-9 w-24 rounded-full" />
              <Skeleton className="h-9 w-32 rounded-full" />
            </div>
          </div>
          <div className="space-y-3 rounded-xl bg-card p-6 shadow-card">
            {Array.from({ length: 7 }, (_, i) => (
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
