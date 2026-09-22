import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the flow's shape: the progress rail, one dominant title, then the single card the step lives in. */
export default function HireLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="mx-auto w-full max-w-[720px]">
      <span className="sr-only">Loading the hire flow…</span>

      <div className="mb-7 space-y-2.5">
        <Skeleton className="h-3.5 w-28 rounded-sm" />
        <div className="flex gap-1">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-1 flex-1 rounded-full" />
          ))}
        </div>
      </div>

      <div className="mb-10 space-y-3">
        <Skeleton className="h-10 w-3/4 rounded-lg" />
        <Skeleton className="h-5 w-full max-w-[52ch] rounded-sm" />
      </div>

      <div className="space-y-4 rounded-xl bg-card p-7 shadow-card">
        <Skeleton className="h-5 w-2/3 rounded-sm" />
        <Skeleton className="h-5 w-1/2 rounded-sm" />
        <Skeleton className="h-36 w-full rounded-lg" />
      </div>

      <div className="mt-8 flex justify-end">
        <Skeleton className="h-11 w-36 rounded-full" />
      </div>
    </div>
  );
}
