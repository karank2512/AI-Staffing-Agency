import { ArrowRight, Minus, Pencil, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { TONE_CLASSES } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { BlueprintDiffEntry } from "@/server/domain";

const KIND_META: Record<BlueprintDiffEntry["kind"], { label: string; className: string; Icon: typeof Plus }> = {
  added: { label: "Added", className: TONE_CLASSES.success.badge, Icon: Plus },
  removed: { label: "Removed", className: TONE_CLASSES.failure.badge, Icon: Minus },
  changed: { label: "Changed", className: TONE_CLASSES.running.badge, Icon: Pencil },
};

/** The blueprint diff as a readable change list: one row per entry, before → after. */
export function ChangeList({ entries, baseLabel, targetLabel }: { entries: BlueprintDiffEntry[]; baseLabel: string; targetLabel: string }) {
  if (entries.length === 0) {
    return (
      <Card>
        <CardContent>
          <EmptyState title="Nothing changes" description={`${targetLabel} has the same design as ${baseLabel}.`} />
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden py-0">
      <ol className="divide-y">
        {entries.map((entry) => {
          const meta = KIND_META[entry.kind];
          return (
            <li key={`${entry.kind}:${entry.path}`} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-4">
              <div className="flex items-start gap-2">
                <span className={cn("mt-0.5 inline-flex h-4.5 shrink-0 items-center gap-0.5 rounded-full border px-1.5 text-[10px] font-medium", meta.className)}>
                  <meta.Icon className="size-2.5" aria-hidden="true" />
                  {meta.label}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{entry.label}</p>
                  <p className="truncate font-mono text-[10px] text-muted-foreground/70">{entry.path}</p>
                </div>
              </div>
              <div className="flex min-w-0 flex-col gap-1 text-xs sm:flex-row sm:items-start sm:gap-2">
                {entry.kind !== "added" ? (
                  <Excerpt text={entry.before} tone="before" />
                ) : null}
                {entry.kind === "changed" ? <ArrowRight className="mt-1.5 hidden size-3.5 shrink-0 text-muted-foreground sm:block" aria-hidden="true" /> : null}
                {entry.kind !== "removed" ? <Excerpt text={entry.after} tone="after" /> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function Excerpt({ text, tone }: { text: string | undefined; tone: "before" | "after" }) {
  return (
    <p
      className={cn(
        "min-w-0 flex-1 rounded-md border px-2 py-1.5 leading-5 text-pretty break-words",
        tone === "before" ? "border-rose-100 bg-rose-50/60 text-rose-900/80 line-through decoration-rose-300" : "border-emerald-100 bg-emerald-50/70 text-emerald-900",
      )}
    >
      {text && text.length > 0 ? text : <span className="italic opacity-60">empty</span>}
    </p>
  );
}
