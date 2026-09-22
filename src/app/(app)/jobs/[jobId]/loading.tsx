import type { ComponentProps } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function Bone({ className, ...props }: ComponentProps<typeof Skeleton>) {
  return <Skeleton className={cn("bg-slate-200/70", className)} {...props} />;
}

/** Mirrors /jobs/[jobId]: breadcrumb + header → stat row → two-column detail. */
export default function JobDetailLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading job…</span>

      <div className="mb-6 space-y-3">
        <Bone className="h-3.5 w-32" />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <Bone className="h-7 w-80 max-w-full" />
            <Bone className="h-4 w-64" />
          </div>
          <div className="flex gap-2">
            <Bone className="h-8 w-24" />
            <Bone className="h-8 w-40" />
          </div>
        </div>
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

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="space-y-8 lg:col-span-2">
          <div className="space-y-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <Bone className="h-5 w-40" />
            <Bone className="h-3 w-3/4" />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Bone key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
            <Bone className="h-3 w-full" />
            <Bone className="h-3 w-5/6" />
            <Bone className="h-3 w-2/3" />
          </div>
          <div className="rounded-xl bg-card ring-1 ring-foreground/10">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex items-center gap-6 border-b px-4 py-3 last:border-0">
                <Bone className="h-5 w-20 rounded-full" />
                <Bone className="h-4 w-16" />
                <div className="flex items-center gap-2">
                  <Bone className="size-6 rounded-full" />
                  <Bone className="h-4 w-14" />
                </div>
                <Bone className="h-4 w-24" />
                <Bone className="h-4 w-40" />
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-6">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="space-y-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <Bone className="h-5 w-32" />
              <div className="flex items-center gap-3">
                <Bone className="size-9 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Bone className="h-4 w-28" />
                  <Bone className="h-3 w-40 max-w-full" />
                </div>
              </div>
              <Bone className="h-3 w-full" />
              <Bone className="h-3 w-4/5" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
