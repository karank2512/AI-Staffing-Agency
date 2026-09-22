import { cn } from "@/lib/utils";
import { SCORE_BAND_CLASSES, scoreBand } from "@/lib/status";

export interface ScoreRingProps {
  /** Worker / run score on a 0..100 scale, or `null` when there is not enough data yet. */
  score: number | null;
  /** Outer diameter in px. Default 44 (cards); 72 reads as a small hero. On a profile header use `ScoreMetric`. */
  size?: number;
  className?: string;
}

/**
 * A thin, calm gauge: a 3px arc on a light track. Only the arc carries the band colour — the number stays in
 * foreground, because a coloured number reads as an alert. `null` renders a dashed track and an em-dash, so
 * "not rated yet" never looks like a zero.
 */
export function ScoreRing({ score, size = 44, className }: ScoreRingProps) {
  const hasScore = score !== null && Number.isFinite(score);
  const value = hasScore ? Math.min(100, Math.max(0, Math.round(score))) : null;
  const band = SCORE_BAND_CLASSES[scoreBand(value)];

  // Geometry lives in a fixed 100-unit viewBox, so a 3px stroke stays 3px at any rendered size.
  const stroke = (3 / size) * 100;
  const radius = (100 - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - (value ?? 0) / 100);
  const fontSize = Math.max(12, Math.round(size * 0.35));

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
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeDasharray={value === null ? `${stroke * 1.6} ${stroke * 1.6}` : undefined}
          className={value === null ? "stroke-input" : "stroke-secondary"}
        />
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
            className={cn("transition-[stroke-dashoffset] duration-[400ms] ease-out", band.stroke)}
          />
        ) : null}
      </svg>
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center font-semibold tracking-[-0.02em] tabular-nums",
          value === null ? "text-tertiary" : "text-foreground",
        )}
        style={{ fontSize, lineHeight: 1 }}
      >
        {value ?? "—"}
      </span>
    </span>
  );
}

export interface ScoreMetricProps {
  score: number | null;
  /** Caption under the number. Default "Performance". */
  label?: string;
  className?: string;
}

/**
 * The profile-header form of a score: a big quiet number with the band word underneath ("Strong", "Watch",
 * "At risk") instead of a ring, so the page has one focal number rather than a second dial.
 */
export function ScoreMetric({ score, label = "Performance", className }: ScoreMetricProps) {
  const hasScore = score !== null && Number.isFinite(score);
  const value = hasScore ? Math.min(100, Math.max(0, Math.round(score))) : null;
  const band = SCORE_BAND_CLASSES[scoreBand(value)];

  return (
    <div data-slot="score-metric" className={cn("flex flex-col", className)}>
      <span className={cn("text-metric-xl", value === null ? "text-tertiary" : "text-foreground")}>
        {value ?? "—"}
      </span>
      <span className="mt-1 text-footnote text-muted-foreground">
        {label} · <span className={band.text}>{band.label}</span>
      </span>
    </div>
  );
}
