import type { ComponentProps } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function Bone({ className, ...props }: ComponentProps<typeof Skeleton>) {
  return <Skeleton className={cn("bg-slate-200/70", className)} {...props} />;
}

/** Route-level fallback for /hire: header, the five-stop stepper, then one large card — the shape of every step. */
export default function HireLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading the hire flow…</span>

      <div className="mb-6 space-y-2">
        <Bone className="h-7 w-44" />
        <Bone className="h-4 w-96 max-w-full" />
      </div>

      <div className="mb-8 flex items-center gap-3">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex flex-1 items-center gap-3">
            <Bone className="h-7 w-28 rounded-full" />
            {i < 4 ? <Bone className="h-px flex-1" /> : null}
          </div>
        ))}
      </div>

      <div className="space-y-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <Bone className="h-4 w-40" />
        <Bone className="h-40 w-full" />
        <div className="flex gap-2">
          <Bone className="h-8 w-32 rounded-full" />
          <Bone className="h-8 w-40 rounded-full" />
          <Bone className="h-8 w-36 rounded-full" />
        </div>
        <div className="flex justify-end pt-2">
          <Bone className="h-8 w-32" />
        </div>
      </div>
    </div>
  );
}
