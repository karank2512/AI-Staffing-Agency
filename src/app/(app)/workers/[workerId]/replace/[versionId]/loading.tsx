import type { ComponentProps } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function Bone({ className, ...props }: ComponentProps<typeof Skeleton>) {
  return <Skeleton className={cn("bg-slate-200/70", className)} {...props} />;
}

/** Mirrors the replace page: header → impact tiles → two comparison cards beside the decision card. */
export default function ReplaceLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading the proposal…</span>

      <div className="mb-6 space-y-3">
        <Bone className="h-3.5 w-56" />
        <div className="flex items-center gap-3">
          <Bone className="size-9 rounded-full" />
          <Bone className="h-7 w-72 max-w-full" />
        </div>
        <Bone className="h-4 w-96 max-w-full" />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <Bone className="h-4 w-24" />
            <Bone className="h-7 w-16" />
            <Bone className="h-3 w-32" />
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="grid gap-4 md:grid-cols-2 lg:col-span-2">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="space-y-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <Bone className="h-4 w-40" />
              <Bone className="h-12 w-full" />
              <Bone className="h-3 w-full" />
              <Bone className="h-3 w-4/5" />
              <Bone className="h-3 w-2/3" />
              <div className="flex gap-2 pt-1">
                <Bone className="h-6 w-20 rounded-full" />
                <Bone className="h-6 w-24 rounded-full" />
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <Bone className="h-4 w-32" />
          <Bone className="h-3 w-full" />
          <Bone className="h-8 w-full" />
          <Bone className="h-9 w-40" />
        </div>
      </div>
    </div>
  );
}
