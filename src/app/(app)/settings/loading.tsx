import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors /settings: title, the section rail, and one group of hairline rows. No spinners. */
export default function SettingsLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading settings…</span>

      <div className="mb-10 space-y-3">
        <Skeleton className="h-8 w-40 rounded-lg" />
        <Skeleton className="h-5 w-[30rem] max-w-full rounded-lg" />
      </div>

      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[13.75rem_minmax(0,1fr)]">
        <div className="hidden space-y-1.5 lg:block">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-[10px]" />
          ))}
        </div>

        <div className="max-w-[45rem] space-y-8">
          <div className="space-y-2">
            <Skeleton className="h-6 w-36 rounded-lg" />
            <Skeleton className="h-4 w-64 rounded-lg" />
          </div>

          {Array.from({ length: 2 }, (_, group) => (
            <div key={group} className="space-y-3">
              <Skeleton className="h-4 w-28 rounded-lg" />
              <Card className="gap-0 py-2">
                {Array.from({ length: group === 0 ? 2 : 4 }, (_, row) => (
                  <div
                    key={row}
                    className="mx-6 flex items-center justify-between gap-6 border-b border-border py-5 last:border-0"
                  >
                    <div className="min-w-0 flex-1 space-y-2">
                      <Skeleton className="h-4 w-40 rounded-lg" />
                      <Skeleton className="h-3.5 w-full max-w-sm rounded-lg" />
                    </div>
                    <Skeleton className="h-5 w-20 shrink-0 rounded-lg" />
                  </div>
                ))}
              </Card>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
