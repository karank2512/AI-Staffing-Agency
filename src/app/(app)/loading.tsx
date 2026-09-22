import type { ComponentProps } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** The primitive's `bg-muted` nearly vanishes on white cards; one step darker reads as "loading" without shouting. */
function Bone({ className, ...props }: ComponentProps<typeof Skeleton>) {
  return <Skeleton className={cn("bg-slate-200/70", className)} {...props} />;
}

/** Route-level fallback for every (app) page: mirrors the standard layout (PageHeader → stat row → cards). */
export default function AppLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading…</span>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Bone className="h-7 w-48" />
          <Bone className="h-4 w-80 max-w-full" />
        </div>
        <Bone className="h-8 w-32" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <Bone className="h-4 w-24" />
            <Bone className="h-7 w-20" />
            <Bone className="h-3 w-32" />
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="space-y-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <div className="flex items-center gap-3">
              <Bone className="size-9 rounded-full" />
              <div className="flex-1 space-y-2">
                <Bone className="h-4 w-28" />
                <Bone className="h-3 w-40 max-w-full" />
              </div>
            </div>
            <Bone className="h-3 w-full" />
            <Bone className="h-3 w-4/5" />
            <div className="flex gap-2 pt-1">
              <Bone className="h-5 w-16 rounded-full" />
              <Bone className="h-5 w-20 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
