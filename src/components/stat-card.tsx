import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { IconSlot, type IconProp } from "@/components/icon-slot";
import { Sparkline } from "@/components/sparkline";
import { cn } from "@/lib/utils";

export interface StatTrend {
  /** Arrow direction. Omit when you only want the sparkline. */
  direction?: "up" | "down" | "flat";
  /** Short caption next to the arrow: "+12% vs last week", "3 more than last month". */
  label?: string;
  /**
   * Whether the movement is good news. Defaults: up = positive, down = negative, flat = neutral —
   * override for metrics where up is bad (cost, failure rate).
   */
  tone?: "positive" | "negative" | "neutral";
  /** Optional series drawn as a sparkline on the right (oldest first). */
  values?: number[];
}

export interface StatCardProps {
  /** Short noun phrase: "Active workers", "Spend this month". */
  label: string;
  /** Pre-formatted headline value (use the helpers in `@/lib/format`). */
  value: ReactNode;
  /** One quiet line of context under the value. */
  hint?: ReactNode;
  /** Lucide icon component or element, shown top-right. */
  icon?: IconProp;
  trend?: StatTrend;
  className?: string;
}

const TREND_TONE = {
  positive: "text-emerald-600",
  negative: "text-rose-600",
  neutral: "text-muted-foreground",
} as const;

const TREND_ICON = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus } as const;

function defaultTone(direction: StatTrend["direction"]): NonNullable<StatTrend["tone"]> {
  if (direction === "up") return "positive";
  if (direction === "down") return "negative";
  return "neutral";
}

/** KPI tile for overview rows. Lay out with `grid gap-4 sm:grid-cols-2 lg:grid-cols-4`. */
export function StatCard({ label, value, hint, icon, trend, className }: StatCardProps) {
  const tone = trend ? (trend.tone ?? defaultTone(trend.direction)) : "neutral";
  const TrendIcon = trend?.direction ? TREND_ICON[trend.direction] : null;
  const hasTrendLine = Boolean(trend && (trend.direction || trend.label));

  return (
    <div
      data-slot="stat-card"
      className={cn("flex flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[13px] font-medium text-muted-foreground">{label}</p>
        {icon ? (
          <span className="text-muted-foreground/70">
            <IconSlot icon={icon} className="size-4" />
          </span>
        ) : null}
      </div>

      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0 truncate text-2xl leading-8 font-semibold tracking-tight tabular-nums">{value}</div>
        {trend?.values && trend.values.length > 1 ? (
          <Sparkline values={trend.values} className={cn("h-8 w-24 shrink-0", TREND_TONE[tone])} />
        ) : null}
      </div>

      {hasTrendLine || hint ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {hasTrendLine ? (
            <span className={cn("inline-flex items-center gap-0.5 font-medium", TREND_TONE[tone])}>
              {TrendIcon ? <TrendIcon className="size-3.5" aria-hidden="true" /> : null}
              {trend?.label}
            </span>
          ) : null}
          {hint ? <span className="min-w-0">{hint}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
