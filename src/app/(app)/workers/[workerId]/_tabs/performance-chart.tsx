"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDate, formatDateTime } from "@/lib/format";
import { SCORE_BAND_CLASSES, scoreBand } from "@/lib/status";
import { cn } from "@/lib/utils";

export interface ScoreTrendPoint {
  runId: string;
  /** ISO */
  at: string;
  /** 0..100 */
  score: number;
}

export interface PerformanceChartProps {
  points: ScoreTrendPoint[];
  workerName: string;
  className?: string;
}

interface Datum extends ScoreTrendPoint {
  index: number;
  t: number;
}

const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 11 } as const;

/**
 * Per-run score, chronological (single series: no legend — the title names it). Clicking a point opens the run.
 * Reference lines mark the health bands the ScoreRing uses, so "why is Alex amber?" is visible at a glance.
 */
export function PerformanceChart({ points, workerName, className }: PerformanceChartProps) {
  const router = useRouter();
  const data = useMemo<Datum[]>(() => points.map((p, index) => ({ ...p, index, t: new Date(p.at).getTime() })), [points]);

  // Sequential x-position (not time) keeps bursts of runs readable; the tooltip carries the real timestamp.
  const tickEvery = Math.max(1, Math.ceil(data.length / 6));

  return (
    <div className={cn("h-56 w-full", className)} role="img" aria-label={`${workerName}'s score per run, oldest to newest`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: -16 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="0" />
          <XAxis
            dataKey="index"
            type="number"
            domain={[0, Math.max(0, data.length - 1)]}
            ticks={data.filter((d) => d.index % tickEvery === 0 || d.index === data.length - 1).map((d) => d.index)}
            tickFormatter={(i: number) => (data[i] ? formatDate(data[i].at).replace(/, \d{4}$/, "") : "")}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            minTickGap={24}
          />
          <YAxis domain={[0, 100]} ticks={[0, 25, 50, 65, 80, 100]} tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} />
          <ReferenceLine y={80} stroke="var(--chart-3)" strokeDasharray="4 4" strokeOpacity={0.6} />
          <ReferenceLine y={65} stroke="var(--chart-4)" strokeDasharray="4 4" strokeOpacity={0.7} />
          <Tooltip
            cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1, strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              const d = active && payload && payload.length > 0 ? (payload[0].payload as Datum) : null;
              if (!d) return null;
              const band = SCORE_BAND_CLASSES[scoreBand(d.score)];
              return (
                <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-sm">
                  <p className="text-muted-foreground">{formatDateTime(d.at)}</p>
                  <p className="mt-0.5 flex items-baseline gap-1.5">
                    <span className="metric text-base font-semibold text-foreground">{Math.round(d.score)}</span>
                    <span className={cn("font-medium", band.text)}>{band.label}</span>
                  </p>
                  <p className="mt-0.5 text-muted-foreground">Click to open the run</p>
                </div>
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="score"
            stroke="var(--chart-1)"
            strokeWidth={2}
            dot={{ r: 4, strokeWidth: 2, stroke: "var(--card)", fill: "var(--chart-1)" }}
            activeDot={{
              r: 6,
              strokeWidth: 2,
              stroke: "var(--card)",
              fill: "var(--chart-1)",
              cursor: "pointer",
              onClick: (_e, payload) => {
                const runId = (payload as { payload?: Datum } | undefined)?.payload?.runId;
                if (runId) router.push(`/runs/${runId}`);
              },
            }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
