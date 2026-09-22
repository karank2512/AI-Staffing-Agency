import type { ComponentProps } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function Bone({ className, ...props }: ComponentProps<typeof Skeleton>) {
  return <Skeleton className={cn("bg-slate-200/70", className)} {...props} />;
}

/** Mirrors /activity: header with the two filter selects → day headings → cards of feed rows. */
export default function ActivityLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading activity…</span>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Bone className="h-7 w-28" />
          <Bone className="h-4 w-96 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Bone className="h-8 w-40" />
          <Bone className="h-8 w-36" />
        </div>
      </div>

      <div className="space-y-8">
        {[4, 3].map((rows, day) => (
          <section key={day} className="space-y-3">
            <Bone className="h-3.5 w-20" />
            <div className="rounded-xl bg-card px-4 ring-1 ring-foreground/10">
              {Array.from({ length: rows }, (_, i) => (
                <div key={i} className="flex items-start gap-3 border-b py-3 last:border-0">
                  <Bone className="size-6 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Bone className="h-4 w-80 max-w-full" />
                    <Bone className="h-3 w-56 max-w-full" />
                  </div>
                  <Bone className="h-3.5 w-16" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
