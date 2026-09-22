"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDate, formatUsd, formatUsdPrecise } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface UsageChartProps {
  /** One entry per calendar day, oldest first, zero-filled (`date` = yyyy-MM-dd). */
  byDay: Array<{ date: string; modelCostUsd: number; toolCostUsd: number; billableUsd: number }>;
  className?: string;
}

type Point = UsageChartProps["byDay"][number] & { label: string; totalCostUsd: number };

const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 11 } as const;

/** Local-day parse: `new Date("2026-09-12")` would be UTC midnight and shift a day in western time zones. */
function localDay(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function shortDay(key: string): string {
  return formatDate(localDay(key)).replace(/, \d{4}$/, "");
}

/** Daily cost, model time stacked on tool fees. Hover a day for the split and what it would bill. */
export function UsageChart({ byDay, className }: UsageChartProps) {
  const data = useMemo<Point[]>(
    () => byDay.map((d) => ({ ...d, label: shortDay(d.date), totalCostUsd: d.modelCostUsd + d.toolCostUsd })),
    [byDay],
  );
  const max = Math.max(0, ...data.map((d) => d.totalCostUsd));
  const tickEvery = Math.max(1, Math.ceil(data.length / 8));

  return (
    <div className={cn("space-y-3", className)}>
      <div className="h-64 w-full" role="img" aria-label="Daily cost, model calls stacked on tool fees, oldest to newest">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 12, right: 8, bottom: 4, left: -8 }} barCategoryGap={data.length > 31 ? "12%" : "24%"}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="label"
              interval={tickEvery - 1}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              minTickGap={16}
            />
            <YAxis
              domain={[0, max > 0 ? "auto" : 1]}
              tickFormatter={(v: number) => (v === 0 ? "$0" : formatUsd(v))}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.6 }}
              content={({ active, payload }) => {
                const d = active && payload && payload.length > 0 ? (payload[0].payload as Point) : null;
                if (!d) return null;
                return (
                  <div className="min-w-44 rounded-lg border bg-popover px-3 py-2 text-xs shadow-sm">
                    <p className="text-muted-foreground">{formatDate(localDay(d.date))}</p>
                    <p className="metric mt-0.5 text-base font-semibold text-foreground">
                      {d.totalCostUsd > 0 ? formatUsdPrecise(d.totalCostUsd) : "No usage"}
                    </p>
                    {d.totalCostUsd > 0 ? (
                      <dl className="mt-1.5 space-y-0.5">
                        <div className="flex items-center justify-between gap-4">
                          <dt className="flex items-center gap-1.5 text-muted-foreground">
                            <span className="size-2 rounded-full bg-chart-1" aria-hidden="true" />
                            Models
                          </dt>
                          <dd className="metric">{formatUsdPrecise(d.modelCostUsd)}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <dt className="flex items-center gap-1.5 text-muted-foreground">
                            <span className="size-2 rounded-full bg-chart-2" aria-hidden="true" />
                            Tools
                          </dt>
                          <dd className="metric">{formatUsdPrecise(d.toolCostUsd)}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-4 border-t pt-1 text-muted-foreground">
                          <dt>Billable</dt>
                          <dd className="metric">{formatUsdPrecise(d.billableUsd)}</dd>
                        </div>
                      </dl>
                    ) : null}
                  </div>
                );
              }}
            />
            {/* Tool fees sit on the baseline; model time stacks on top and carries the rounded cap. */}
            <Bar dataKey="toolCostUsd" stackId="cost" fill="var(--chart-2)" maxBarSize={28} isAnimationActive={false} />
            <Bar dataKey="modelCostUsd" stackId="cost" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-chart-1" aria-hidden="true" />
          Model calls
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-chart-2" aria-hidden="true" />
          Tool fees
        </li>
      </ul>
    </div>
  );
}
