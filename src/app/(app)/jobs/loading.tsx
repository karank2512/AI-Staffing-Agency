import type { ComponentProps } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function Bone({ className, ...props }: ComponentProps<typeof Skeleton>) {
  return <Skeleton className={cn("bg-slate-200/70", className)} {...props} />;
}

/** Mirrors the /jobs layout: header → filter pills → a table of rows. */
export default function JobsLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading jobs…</span>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Bone className="h-7 w-24" />
          <Bone className="h-4 w-96 max-w-full" />
        </div>
        <Bone className="h-8 w-32" />
      </div>

      <div className="mb-4 flex gap-1.5">
        {Array.from({ length: 6 }, (_, i) => (
          <Bone key={i} className="h-7 w-20 rounded-full" />
        ))}
      </div>

      <div className="rounded-xl bg-card ring-1 ring-foreground/10">
        <div className="flex items-center gap-6 border-b px-4 py-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Bone key={i} className="h-3.5 w-20" />
          ))}
        </div>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-6 border-b px-4 py-3 last:border-0">
            <div className="w-64 space-y-1.5">
              <Bone className="h-4 w-52" />
              <Bone className="h-3 w-28" />
            </div>
            <Bone className="h-5 w-20 rounded-full" />
            <div className="flex items-center gap-2">
              <Bone className="size-6 rounded-full" />
              <Bone className="h-4 w-16" />
            </div>
            <Bone className="h-4 w-32" />
            <Bone className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
