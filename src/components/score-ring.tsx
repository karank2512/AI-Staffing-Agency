import { cn } from "@/lib/utils";
import { SCORE_BAND_CLASSES, scoreBand } from "@/lib/status";

export interface ScoreRingProps {
  /** Worker / run score on a 0..100 scale, or `null` when there is not enough data yet. */
  score: number | null;
  /** Outer diameter in px. Default 48; use ~28 in table rows and ~96 for a profile hero. */
  size?: number;
  className?: string;
}

/**
 * Circular score gauge. Colour follows the shared bands (≥ 80 emerald · 65–79 amber · < 65 rose);
 * `null` renders a muted empty ring with an em-dash so "not rated yet" never looks like a zero.
 */
export function ScoreRing({ score, size = 48, className }: ScoreRingProps) {
  const hasScore = score !== null && Number.isFinite(score);
  const value = hasScore ? Math.min(100, Math.max(0, Math.round(score))) : null;
  const band = SCORE_BAND_CLASSES[scoreBand(value)];

  // Geometry lives in a fixed 100-unit viewBox so stroke proportions hold at every size.
  const stroke = size <= 32 ? 12 : 9;
  const radius = (100 - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - (value ?? 0) / 100);
  const fontSize = Math.max(9, Math.round(size * 0.32));

  return (
    <span
      data-slot="score-ring"
      role="img"
      aria-label={value === null ? "No score yet" : `Score ${value} out of 100`}
      title={value === null ? "Not enough data to score yet" : `${value} / 100 · ${band.label}`}
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={radius} fill="none" strokeWidth={stroke} className="stroke-slate-200/80" />
        {value !== null && value > 0 ? (
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className={cn("transition-[stroke-dashoffset] duration-500 ease-out", band.stroke)}
          />
        ) : null}
      </svg>
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center font-semibold tabular-nums",
          value === null ? "text-muted-foreground" : "text-foreground",
        )}
        style={{ fontSize, lineHeight: 1 }}
      >
        {value ?? "—"}
      </span>
    </span>
  );
}
