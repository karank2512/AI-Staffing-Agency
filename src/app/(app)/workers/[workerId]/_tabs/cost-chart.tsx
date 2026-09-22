"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDate, formatUsd, formatUsdPrecise } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface CostChartProps {
  /** One entry per calendar day, oldest first, zero-filled (`date` = yyyy-MM-dd). */
  byDay: Array<{ date: string; costUsd: number }>;
  className?: string;
}

const AXIS_TICK = { fill: "var(--chart-axis)", fontSize: 12 } as const;

/** Local-day parse: `new Date("2026-09-12")` would be UTC midnight and shift a day in western time zones. */
function localDay(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** Daily spend for one worker — one series, hover for the exact amount. */
export function CostChart({ byDay, className }: CostChartProps) {
  const data = useMemo(
    () => byDay.map((d) => ({ ...d, label: formatDate(localDay(d.date)).replace(/, \d{4}$/, "") })),
    [byDay],
  );
  const max = Math.max(0, ...data.map((d) => d.costUsd));
  const tickEvery = Math.max(1, Math.ceil(data.length / 6));

  return (
    <div className={cn("h-60 w-full", className)} role="img" aria-label="Daily spend, oldest to newest">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 16, right: 8, bottom: 4, left: -8 }} barCategoryGap="24%">
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" interval={tickEvery - 1} tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={16} />
          <YAxis
            domain={[0, max > 0 ? "auto" : 1]}
            tickFormatter={(v: number) => (v === 0 ? "$0" : formatUsd(v))}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={56}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            content={({ active, payload }) => {
              const d = active && payload && payload.length > 0 ? (payload[0].payload as { date: string; costUsd: number }) : null;
              if (!d) return null;
              return (
                <div className="material-thick text-footnote rounded-lg px-3 py-2 shadow-popover">
                  <p className="text-muted-foreground">{formatDate(localDay(d.date))}</p>
                  <p className="metric mt-0.5 text-[15px] font-semibold text-foreground">
                    {d.costUsd > 0 ? formatUsdPrecise(d.costUsd) : "No spend"}
                  </p>
                </div>
              );
            }}
          />
          <Bar dataKey="costUsd" fill="var(--chart-1)" radius={[6, 6, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
