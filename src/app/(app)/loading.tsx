import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level fallback for every (app) page: skeletons that mirror the real layout (title, stat strip, cards),
 * never a spinner, so the page doesn't jump when the data lands.
 */
export default function AppLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading…</span>

      <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-3">
          <Skeleton className="h-8 w-56 rounded-sm" />
          <Skeleton className="h-4 w-80 max-w-full rounded-sm" />
        </div>
        <Skeleton className="h-9 w-32 rounded-full" />
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border shadow-card md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-3 bg-card p-6">
            <Skeleton className="h-3.5 w-24 rounded-sm" />
            <Skeleton className="h-8 w-20 rounded-sm" />
          </div>
        ))}
      </div>

      <div className="mt-14 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="space-y-5 rounded-xl bg-card p-6 shadow-card">
            <div className="flex items-center gap-4">
              <Skeleton className="size-12 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-28 rounded-sm" />
                <Skeleton className="h-3.5 w-40 max-w-full rounded-sm" />
              </div>
            </div>
            <Skeleton className="h-3.5 w-44 rounded-sm" />
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-9 rounded-sm" />
              <Skeleton className="h-9 rounded-sm" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
