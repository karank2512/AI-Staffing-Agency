import { cn } from "@/lib/utils";

export interface SparklineProps {
  /** Chronological series (oldest first). Non-finite entries are ignored. */
  values: number[];
  /**
   * Sizing + colour. The line uses `currentColor`, so set colour with a text class. The default is deliberately
   * quiet — `h-7 w-20 text-foreground/40` — because a sparkline is context, not the headline.
   */
  className?: string;
  /** Fill the area under the line at 8%. Off by default; use it only inside a chart card, never in a stat. */
  fill?: boolean;
}

const WIDTH = 100;
const HEIGHT = 28;
const PAD = 2.5;

/** Tiny inline trend line (score trend, daily cost). Pure SVG — no chart library, works in server components. */
export function Sparkline({ values, className, fill = false }: SparklineProps) {
  const series = values.filter((v) => Number.isFinite(v));
  const classes = cn("inline-block h-7 w-20 overflow-visible text-foreground/40", className);

  if (series.length === 0) {
    // Keep the footprint so rows with and without data stay aligned.
    return (
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className={classes} aria-hidden="true">
        <line
          x1={PAD}
          x2={WIDTH - PAD}
          y1={HEIGHT / 2}
          y2={HEIGHT / 2}
          stroke="currentColor"
          strokeOpacity={0.25}
          strokeWidth={1.5}
          strokeDasharray="2 4"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min;
  const x = (i: number) => (series.length === 1 ? WIDTH / 2 : PAD + (i * (WIDTH - PAD * 2)) / (series.length - 1));
  // A flat series sits on the midline instead of hugging the bottom edge.
  const y = (v: number) => (span === 0 ? HEIGHT / 2 : HEIGHT - PAD - ((v - min) / span) * (HEIGHT - PAD * 2));

  const points = series.map((v, i) => [x(i), y(v)] as const);
  const line = points.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(2)} ${py.toFixed(2)}`).join(" ");
  const first = points[0] as readonly [number, number];
  const last = points[points.length - 1] as readonly [number, number];
  const area = `${line} L${last[0].toFixed(2)} ${HEIGHT} L${first[0].toFixed(2)} ${HEIGHT} Z`;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className={classes}
      role="img"
      aria-label={`Trend over ${series.length} points, latest ${series[series.length - 1]}`}
    >
      {fill && series.length > 1 ? <path d={area} fill="currentColor" fillOpacity={0.08} stroke="none" /> : null}
      {series.length > 1 ? (
        <path
          d={line}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {/* Zero-length round-capped segment = a dot that stays circular even though the viewBox is stretched. */}
      <path
        d={`M${last[0].toFixed(2)} ${last[1].toFixed(2)} l0.001 0`}
        fill="none"
        stroke="currentColor"
        strokeWidth={4.5}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
