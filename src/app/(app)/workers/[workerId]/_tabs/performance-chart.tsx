"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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
}

const AXIS_TICK = { fill: "var(--chart-axis)", fontSize: 12 } as const;

/**
 * Per-run score, oldest to newest. One 2px line with a whisper of fill, dots only on hover, and the two bands
 * the score is read against drawn as dashed reference lines. Clicking a point opens that run.
 */
export function PerformanceChart({ points, workerName, className }: PerformanceChartProps) {
  const router = useRouter();
  const data = useMemo<Datum[]>(() => points.map((p, index) => ({ ...p, index })), [points]);
  // Sequential x-position (not time) keeps bursts of runs readable; the tooltip carries the real timestamp.
  const tickEvery = Math.max(1, Math.ceil(data.length / 5));

  return (
    <div className={cn("h-60 w-full", className)} role="img" aria-label={`${workerName}'s score per run, oldest to newest`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 16, right: 44, bottom: 4, left: -16 }}>
          <defs>
            <linearGradient id="score-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.08} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="index"
            type="number"
            domain={[0, Math.max(0, data.length - 1)]}
            ticks={data.filter((d) => d.index % tickEvery === 0 || d.index === data.length - 1).map((d) => d.index)}
            tickFormatter={(i: number) => (data[i] ? formatDate(data[i].at).replace(/, \d{4}$/, "") : "")}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
          />
          <YAxis domain={[0, 100]} ticks={[0, 50, 65, 80, 100]} tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} />
          <ReferenceLine
            y={80}
            stroke="var(--input)"
            strokeDasharray="4 4"
            label={{ value: "Strong", position: "right", fill: "var(--chart-axis)", fontSize: 12 }}
          />
          <ReferenceLine
            y={65}
            stroke="var(--input)"
            strokeDasharray="4 4"
            label={{ value: "Watch", position: "right", fill: "var(--chart-axis)", fontSize: 12 }}
          />
          <Tooltip
            cursor={{ stroke: "var(--input)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              const d = active && payload && payload.length > 0 ? (payload[0].payload as Datum) : null;
              if (!d) return null;
              const band = SCORE_BAND_CLASSES[scoreBand(d.score)];
              return (
                <div className="material-thick text-footnote rounded-lg px-3 py-2 shadow-popover">
                  <p className="text-muted-foreground">{formatDateTime(d.at)}</p>
                  <p className="mt-0.5 flex items-baseline gap-1.5">
                    <span className="metric text-[15px] font-semibold text-foreground">{Math.round(d.score)}</span>
                    <span className={band.text}>{band.label}</span>
                  </p>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="score"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill="url(#score-fill)"
            dot={false}
            activeDot={{
              r: 4,
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
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
