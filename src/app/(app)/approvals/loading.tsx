import type { ComponentProps } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function Bone({ className, ...props }: ComponentProps<typeof Skeleton>) {
  return <Skeleton className={cn("bg-slate-200/70", className)} {...props} />;
}

/** Mirrors /approvals: header → "Waiting on you" request cards → the "Decided" history table. */
export default function ApprovalsLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading approvals…</span>

      <div className="mb-6 space-y-2">
        <Bone className="h-7 w-32" />
        <Bone className="h-4 w-[32rem] max-w-full" />
      </div>

      <div className="space-y-8">
        <section className="space-y-3">
          <div className="space-y-1.5">
            <Bone className="h-5 w-32" />
            <Bone className="h-3.5 w-64 max-w-full" />
          </div>
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="space-y-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <div className="flex items-start gap-3">
                <Bone className="size-9 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Bone className="h-4 w-80 max-w-full" />
                  <Bone className="h-3.5 w-96 max-w-full" />
                  <Bone className="h-3 w-48" />
                </div>
                <Bone className="h-5 w-24 rounded-full" />
              </div>
              <Bone className="h-28 w-full rounded-lg" />
              <div className="flex items-center justify-between">
                <Bone className="h-8 w-40" />
                <div className="flex gap-2">
                  <Bone className="h-8 w-20" />
                  <Bone className="h-8 w-24" />
                </div>
              </div>
            </div>
          ))}
        </section>

        <section className="space-y-3">
          <div className="space-y-1.5">
            <Bone className="h-5 w-20" />
            <Bone className="h-3.5 w-72 max-w-full" />
          </div>
          <div className="rounded-xl bg-card ring-1 ring-foreground/10">
            <div className="flex items-center gap-6 border-b px-4 py-3">
              {Array.from({ length: 5 }, (_, i) => (
                <Bone key={i} className="h-3.5 w-20" />
              ))}
            </div>
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex items-center gap-6 border-b px-4 py-3 last:border-0">
                <div className="flex w-72 items-center gap-2.5">
                  <Bone className="size-6 rounded-full" />
                  <Bone className="h-4 w-56" />
                </div>
                <Bone className="h-4 w-24" />
                <Bone className="h-5 w-20 rounded-full" />
                <Bone className="h-4 w-24" />
                <Bone className="ml-auto h-4 w-20" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
