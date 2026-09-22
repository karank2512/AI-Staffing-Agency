import { ScoreRing } from "@/components/score-ring";
import { WorkerAvatar } from "@/components/worker-avatar";
import { cn } from "@/lib/utils";

/** The small mocks that sit under the three "How it works" steps, and the two review-section tiles. */

export function BriefMock({ className }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label="A brief being typed: every Monday, summarise what our three main competitors shipped last week and email it to the product team."
      className={cn("rounded-xl bg-card p-5 shadow-card", className)}
    >
      <p className="text-[13px] leading-[18px] font-semibold text-muted-foreground">What do you need done?</p>
      <p className="mt-3 text-[17px] leading-[25px]">
        Every Monday, summarize what our three main competitors shipped last week and email it to the product
        team.
        <span aria-hidden className="ml-0.5 inline-block h-[18px] w-px translate-y-[3px] bg-primary" />
      </p>
      <div className="mt-4 flex items-center justify-between gap-4">
        <span className="text-[13px] text-muted-foreground tabular-nums">118 characters</span>
        <span className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-[14px] font-medium text-primary-foreground">
          Continue
        </span>
      </div>
    </div>
  );
}

export function CandidateMock({ className }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label="A candidate card: Maya, market research analyst, four tools, about four cents per run, with a Hire Maya button."
      className={cn("rounded-xl bg-card p-5 shadow-card", className)}
    >
      <div className="flex items-center gap-3">
        <WorkerAvatar name="Maya Okonkwo" color="sky" size="lg" />
        <div className="min-w-0">
          <p className="text-title-3 truncate">Maya</p>
          <p className="truncate text-[13px] leading-[18px] text-muted-foreground">Market research analyst</p>
        </div>
      </div>
      <dl className="mt-4 space-y-2">
        {[
          ["Tools", "4 · one asks first"],
          ["Schedule", "Mondays at 9:00"],
          ["Expected cost", "$0.04 per run"],
        ].map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4">
            <dt className="text-[13px] text-muted-foreground">{label}</dt>
            <dd className="text-[13px] font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex items-center gap-2.5 border-t border-border pt-4">
        <span className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-[14px] font-medium text-primary-foreground">
          Hire Maya
        </span>
        <span className="text-[13px] font-medium text-link">Ask for changes ›</span>
      </div>
    </div>
  );
}

export function DeliverableMock({ className }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label="A finished deliverable: the weekly competitor digest by Maya, scored 88, with the first lines of the write-up and an Accept button."
      className={cn("rounded-xl bg-card p-5 shadow-card", className)}
    >
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-title-3">Weekly competitor digest</p>
          <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">By Maya · May 19 · Simulated</p>
        </div>
        <ScoreRing score={88} />
      </div>
      <p className="mt-4 text-[15px] leading-[22px] text-muted-foreground">
        Northwind moved billing to usage-based pricing and opened SSO to every plan. Harborline shipped an audit
        export. Vantage was quiet…
      </p>
      <div className="mt-4 flex items-center gap-2.5 border-t border-border pt-4">
        <span className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-[14px] font-medium text-primary-foreground">
          Accept
        </span>
        <span className="text-[13px] font-medium text-link">Request changes ›</span>
      </div>
    </div>
  );
}

const TREND = [58, 63, 61, 68, 72, 70, 77, 81, 79, 84, 86, 88];

export function ScoreTrendMock({ className }: { className?: string }) {
  const width = 300;
  const height = 132;
  const min = 50;
  const max = 95;
  const y = (value: number) => height - ((value - min) / (max - min)) * height;
  const step = width / (TREND.length - 1);
  const line = TREND.map((value, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)} ${y(value).toFixed(1)}`).join(
    " ",
  );

  return (
    <div
      role="img"
      aria-label="A score chart across twelve runs rising from 58 to 88, with dashed reference lines at 80 marked Strong and 65 marked Watch."
      className={cn("rounded-lg bg-muted p-5", className)}
    >
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[132px] w-full" preserveAspectRatio="none" aria-hidden>
        <line x1="0" x2={width} y1={y(80)} y2={y(80)} stroke="#d2d2d7" strokeWidth="1" strokeDasharray="4 4" />
        <line x1="0" x2={width} y1={y(65)} y2={y(65)} stroke="#d2d2d7" strokeWidth="1" strokeDasharray="4 4" />
        <path d={`${line} L${width} ${height} L0 ${height} Z`} fill="rgb(0 113 227 / 0.08)" />
        <path d={line} fill="none" stroke="var(--chart-1)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="mt-3 flex items-center justify-between text-[12px] text-muted-foreground">
        <span>12 runs</span>
        <span className="flex items-center gap-4">
          <span>Watch 65</span>
          <span>Strong 80</span>
        </span>
      </div>
    </div>
  );
}

const COMPARE: [string, string, string, boolean][] = [
  ["Model tier", "Balanced", "Balanced", false],
  ["Sources", "3 competitor sites", "3 sites + release feeds", true],
  ["Emailing", "Asks first", "Asks first", false],
  ["Expected cost", "$0.04 per run", "$0.05 per run", true],
  ["Recent score", "74", "Projected 85", true],
];

export function CompareMock({ className }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label="A before and after comparison between version 2 and version 3 of a worker: same model tier and same asks-first emailing, but more sources, a cent more per run, and a projected score of 85 against a recent 74."
      className={cn("rounded-lg bg-muted p-5", className)}
    >
      <div className="flex items-baseline justify-between gap-4 pb-3 text-[13px] font-semibold text-muted-foreground">
        <span>Current · v2</span>
        <span className="text-foreground">Proposed · v3</span>
      </div>
      <ul>
        {COMPARE.map(([label, before, after, changed]) => (
          <li key={label} className="border-t border-border py-3">
            <p className="text-[12px] leading-4 text-muted-foreground">{label}</p>
            <p className="mt-1 flex items-center gap-2 text-[15px] leading-5">
              <span className="min-w-0 truncate text-muted-foreground">{before}</span>
              <span aria-hidden className="shrink-0 text-muted-foreground">
                →
              </span>
              <span className={cn("min-w-0 truncate", changed ? "font-medium text-foreground" : "text-muted-foreground")}>
                {after}
              </span>
              {changed ? <span className="size-1.5 shrink-0 rounded-full bg-primary" /> : null}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
