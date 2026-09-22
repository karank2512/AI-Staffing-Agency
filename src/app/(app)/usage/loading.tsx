import type { ComponentProps } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function Bone({ className, ...props }: ComponentProps<typeof Skeleton>) {
  return <Skeleton className={cn("bg-slate-200/70", className)} {...props} />;
}

/** Mirrors /usage: header + range picker → four stat tiles → chart + split card → breakdown tables. */
export default function UsageLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading usage…</span>

      <div className="mb-6 flex items-start justify-between gap-6">
        <div className="space-y-2">
          <Bone className="h-7 w-24" />
          <Bone className="h-4 w-[30rem] max-w-full" />
        </div>
        <Bone className="h-8 w-56" />
      </div>

      <div className="space-y-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <Bone className="h-3.5 w-24" />
              <Bone className="h-8 w-28" />
              <Bone className="h-3 w-32" />
            </div>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-4 rounded-xl bg-card p-6 ring-1 ring-foreground/10 lg:col-span-2">
            <Bone className="h-4 w-24" />
            <Bone className="h-3.5 w-72 max-w-full" />
            <Bone className="h-64 w-full rounded-lg" />
          </div>
          <div className="space-y-4 rounded-xl bg-card p-6 ring-1 ring-foreground/10">
            <Bone className="h-4 w-36" />
            <Bone className="h-3 w-full rounded-full" />
            <Bone className="h-4 w-full" />
            <Bone className="h-4 w-full" />
          </div>
        </div>

        <section className="space-y-3">
          <div className="space-y-1.5">
            <Bone className="h-5 w-24" />
            <Bone className="h-3.5 w-80 max-w-full" />
          </div>
          <div className="rounded-xl bg-card ring-1 ring-foreground/10">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex items-center gap-6 border-b px-4 py-3 last:border-0">
                <div className="flex w-56 items-center gap-2.5">
                  <Bone className="size-6 rounded-full" />
                  <Bone className="h-4 w-32" />
                </div>
                <Bone className="ml-auto h-4 w-12" />
                <Bone className="h-4 w-16" />
                <Bone className="h-4 w-16" />
                <Bone className="h-4 w-16" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
