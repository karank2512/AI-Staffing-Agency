import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors /approvals: title → Waiting/Decided segments → the stack of request cards. */
export default function ApprovalsLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading approvals…</span>

      <div className="mb-10 space-y-3">
        <Skeleton className="h-8 w-48 rounded-sm" />
        <Skeleton className="h-5 w-[26rem] max-w-full rounded-sm" />
      </div>

      <div className="space-y-8">
        <Skeleton className="h-8 w-48 rounded-full" />

        <div className="max-w-[820px] space-y-6">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="space-y-6 rounded-xl bg-card p-6 shadow-card">
              <div className="flex items-start gap-4">
                <Skeleton className="size-10 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-[22rem] max-w-full rounded-sm" />
                  <Skeleton className="h-3.5 w-56 max-w-full rounded-sm" />
                </div>
              </div>
              <Skeleton className="h-28 w-full rounded-lg" />
              <div className="flex items-center justify-between gap-4">
                <Skeleton className="h-4 w-40 rounded-sm" />
                <div className="flex gap-2">
                  <Skeleton className="h-9 w-24 rounded-full" />
                  <Skeleton className="h-9 w-24 rounded-full" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
