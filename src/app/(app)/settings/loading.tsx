import type { ComponentProps } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function Bone({ className, ...props }: ComponentProps<typeof Skeleton>) {
  return <Skeleton className={cn("bg-slate-200/70", className)} {...props} />;
}

function CardBone({ rows }: { rows: number }) {
  return (
    <div className="space-y-4 rounded-xl bg-card p-6 ring-1 ring-foreground/10">
      <div className="space-y-2">
        <Bone className="h-4 w-32" />
        <Bone className="h-3.5 w-96 max-w-full" />
      </div>
      <div className="divide-y rounded-lg border">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-4 px-3 py-3">
            <div className="space-y-1.5">
              <Bone className="h-4 w-40" />
              <Bone className="h-3 w-64 max-w-full" />
            </div>
            <Bone className="h-5 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Mirrors /settings: header → Workspace → AI providers → Tool credentials → Executor + Demo data. */
export default function SettingsLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading settings…</span>

      <div className="mb-6 space-y-2">
        <Bone className="h-7 w-28" />
        <Bone className="h-4 w-[34rem] max-w-full" />
      </div>

      <div className="space-y-8">
        <CardBone rows={1} />
        <CardBone rows={4} />
        <CardBone rows={1} />
        <div className="grid gap-6 lg:grid-cols-2">
          <CardBone rows={2} />
          <CardBone rows={1} />
        </div>
      </div>
    </div>
  );
}
