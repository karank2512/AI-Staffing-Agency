import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the replace page: header → impact strip → the aligned comparison rows. No spinner. */
export default function ReplaceLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading the proposal…</span>

      <div className="mb-10 space-y-4">
        <Skeleton className="h-3.5 w-24 rounded-sm" />
        <div className="flex items-center gap-4">
          <Skeleton className="size-12 rounded-full" />
          <Skeleton className="h-9 w-80 max-w-full rounded-lg" />
        </div>
        <Skeleton className="h-5 w-[28rem] max-w-full rounded-sm" />
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border shadow-card md:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="space-y-3 bg-card p-6">
            <Skeleton className="h-3.5 w-24 rounded-sm" />
            <Skeleton className="h-8 w-20 rounded-lg" />
            <Skeleton className="h-3.5 w-32 rounded-sm" />
          </div>
        ))}
      </div>

      <div className="mt-14 space-y-5">
        <Skeleton className="h-6 w-40 rounded-lg" />
        <div className="space-y-6 rounded-xl bg-card p-6 shadow-card">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="grid gap-4 sm:grid-cols-[168px_minmax(0,1fr)_minmax(0,1fr)]">
              <Skeleton className="h-3.5 w-28 rounded-sm" />
              <Skeleton className="h-3.5 w-full rounded-sm" />
              <Skeleton className="h-3.5 w-4/5 rounded-sm" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
