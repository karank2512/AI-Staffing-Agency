import { Bot, Cog, Lock, Sparkles } from "lucide-react";
import { ScoreRing } from "@/components/score-ring";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDuration, formatNumber, formatPercent, formatUsd, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { EstimatedDeltasView, VersionCard } from "@/server/queries/worker-manage";
import { TIER_CLASSES, TIER_LABELS } from "../../../_tabs/versions-labels";

/**
 * Side-by-side comparison for the replace page. Differences between base and target are highlighted in the
 * target card so the eye lands on what changes without reading the whole design twice.
 */

// ── Estimated impact ────────────────────────────────────────────────────────

function signed(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  const rounded = Math.round(pct);
  return `${rounded > 0 ? "+" : ""}${formatNumber(rounded, 0)}%`;
}

/** Up is good for quality; down is good for cost and latency. Zero is neutral. */
function tone(pct: number | null, upIsGood: boolean): "positive" | "negative" | "neutral" {
  if (pct === null || !Number.isFinite(pct) || Math.round(pct) === 0) return "neutral";
  return (pct > 0) === upIsGood ? "positive" : "negative";
}

function direction(pct: number | null): "up" | "down" | "flat" {
  if (pct === null || !Number.isFinite(pct) || Math.round(pct) === 0) return "flat";
  return pct > 0 ? "up" : "down";
}

export function EstimatedDeltas({ deltas, base, target }: { deltas: EstimatedDeltasView; base: VersionCard | null; target: VersionCard }) {
  const costHint = base ? `${formatUsd(base.costPerRunUsd)} → ${formatUsd(target.costPerRunUsd)} per run` : `${formatUsd(target.costPerRunUsd)} per run`;
  const fromAnalysis = deltas.source === "analysis";
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <StatCard
        label="Quality"
        value={signed(deltas.qualityPct)}
        hint={fromAnalysis ? "expected change in deliverable scores" : "not estimated for this change"}
        trend={{ direction: direction(deltas.qualityPct), tone: tone(deltas.qualityPct, true) }}
      />
      <StatCard label="Cost per run" value={signed(deltas.costPct)} hint={costHint} trend={{ direction: direction(deltas.costPct), tone: tone(deltas.costPct, false) }} />
      <StatCard
        label="Run time"
        value={signed(deltas.latencyPct)}
        hint={fromAnalysis ? "expected change in time per run" : "not estimated for this change"}
        trend={{ direction: direction(deltas.latencyPct), tone: tone(deltas.latencyPct, false) }}
      />
    </div>
  );
}

// ── Version cards ───────────────────────────────────────────────────────────

const HIGHLIGHT = "rounded bg-amber-50 px-1 -mx-1 ring-1 ring-amber-200/70";

export interface VersionCompareCardProps {
  card: VersionCard;
  /** The other side, used to highlight differences. */
  against: VersionCard | null;
  role: "base" | "target";
  changeReason: VersionCard["changeReason"];
}

export function VersionCompareCard({ card, against, role, changeReason }: VersionCompareCardProps) {
  const isTarget = role === "target";
  const heading = isTarget ? (changeReason === "REPLACEMENT" ? "Proposed replacement" : changeReason === "SPEC_CHANGE" ? "Proposed change" : `Version ${card.version}`) : card.status === "ACTIVE" ? "Current version" : `Version ${card.version}`;

  const stepsById = new Map((against?.steps ?? []).map((s) => [s.id, s] as const));
  const toolsByName = new Map((against?.tools ?? []).map((t) => [t.toolName, t] as const));
  const kpisById = new Map((against?.kpis ?? []).map((k) => [k.id, k] as const));
  const differs = (a: unknown, b: unknown) => against !== null && isTarget && JSON.stringify(a) !== JSON.stringify(b);

  return (
    <Card className={cn(isTarget && "border-primary/25 ring-primary/15")}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {isTarget ? <Sparkles className="size-4 text-primary" aria-hidden="true" /> : null}
          {heading}
          <StatusBadge kind="version" status={card.status} />
          <span className="text-xs font-normal text-muted-foreground">v{card.version}</span>
        </CardTitle>
        <CardDescription>
          <span className={cn(differs(card.persona.name, against?.persona.name) && HIGHLIGHT)}>{card.persona.name}</span> · {card.persona.title}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <div className="flex items-center gap-4 rounded-lg border bg-muted/40 p-3">
          <ScoreRing score={card.score} size={44} />
          <div className="min-w-0 flex-1 text-xs text-muted-foreground">
            {card.trackRecord ? (
              <>
                <p className="text-sm font-medium text-foreground">
                  {pluralize(card.trackRecord.runs, "run")}
                  {card.trackRecord.successRate !== null ? ` · ${formatPercent(card.trackRecord.successRate)} succeeded` : ""}
                </p>
                <p>
                  {card.trackRecord.acceptanceRate !== null ? `${formatPercent(card.trackRecord.acceptanceRate)} accepted` : "No reviews yet"}
                  {card.trackRecord.avgCostPerRunUsd !== null ? ` · ${formatUsd(card.trackRecord.avgCostPerRunUsd)} per run actual` : ""}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-foreground">{card.runCount === 0 ? "No runs yet" : pluralize(card.runCount, "run")}</p>
                <p>{isTarget ? "Track record starts after the first run." : "No finished runs to rate."}</p>
              </>
            )}
          </div>
        </div>

        <Block title="How the work gets done">
          <ol className="space-y-1.5">
            {card.steps.map((step, i) => {
              const other = stepsById.get(step.id);
              const isNew = against !== null && isTarget && !other;
              const tierChanged = other !== undefined && isTarget && other.tier !== step.tier;
              return (
                <li key={step.id} className="flex items-center gap-2">
                  <span className="w-4 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">{i + 1}</span>
                  {step.kind === "agent" ? <Bot className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : <Cog className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                  <span className={cn("truncate", isNew && HIGHLIGHT)}>{step.name}</span>
                  {step.tier ? (
                    <span className={cn("inline-flex h-4.5 shrink-0 items-center rounded-full border px-1.5 text-[10px] font-medium", TIER_CLASSES[step.tier], tierChanged && "ring-2 ring-amber-300/70")}>
                      {TIER_LABELS[step.tier]}
                    </span>
                  ) : (
                    <span className="shrink-0 text-[11px] text-muted-foreground">{step.detail}</span>
                  )}
                  {isNew ? <span className="shrink-0 text-[10px] font-medium text-amber-700">new</span> : null}
                </li>
              );
            })}
          </ol>
        </Block>

        <Block title="Tools">
          {card.tools.length === 0 ? (
            <p className="text-xs text-muted-foreground">No tools — works from the data it is given.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {card.tools.map((t) => (
                <li key={t.toolName} className={cn("inline-flex h-6 items-center gap-1 rounded-full border bg-card px-2 text-xs", isTarget && against !== null && !toolsByName.has(t.toolName) && "border-amber-300 bg-amber-50")}>
                  {t.displayName}
                  {t.requiresApproval ? <Lock className="size-3 text-amber-600" aria-label="Requires approval" /> : null}
                </li>
              ))}
            </ul>
          )}
        </Block>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Fact label="Cost per run" value={formatUsd(card.costPerRunUsd)} highlight={differs(card.costPerRunUsd, against?.costPerRunUsd)} />
          <Fact label="Per month" value={`${formatUsd(card.monthlyUsd)} · ${formatNumber(card.runsPerMonth, 1)} runs`} highlight={differs(card.monthlyUsd, against?.monthlyUsd)} />
          <Fact label="Schedule" value={card.scheduleLabel} highlight={differs(card.scheduleLabel, against?.scheduleLabel)} />
          <Fact label="Deliverable" value={`${card.deliverable.format.toUpperCase()} · ${card.deliverable.titleTemplate}`} highlight={differs(card.deliverable, against?.deliverable)} />
          <Fact label="Max spend / run" value={formatUsd(card.limits.maxCostPerRunUsd)} highlight={differs(card.limits.maxCostPerRunUsd, against?.limits.maxCostPerRunUsd)} />
          <Fact label="Max duration" value={formatDuration(card.limits.maxRunDurationSec * 1000)} highlight={differs(card.limits.maxRunDurationSec, against?.limits.maxRunDurationSec)} />
        </div>

        <Block title="Targets">
          <ul className="space-y-1">
            {card.kpis.map((k) => {
              const other = kpisById.get(k.id);
              const changed = isTarget && against !== null && (!other || other.target !== k.target);
              return (
                <li key={k.id} className="flex items-center justify-between gap-3 text-xs">
                  <span className="truncate text-muted-foreground">{k.name}</span>
                  <span className={cn("shrink-0 font-medium tabular-nums", changed && HIGHLIGHT)}>
                    {k.direction === "higher_is_better" ? "≥" : "≤"} {k.target}
                  </span>
                </li>
              );
            })}
          </ul>
        </Block>
      </CardContent>
    </Card>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="eyebrow">{title}</h3>
      {children}
    </div>
  );
}

function Fact({ label, value, highlight }: { label: string; value: string; highlight: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("truncate text-sm font-medium tabular-nums", highlight && HIGHLIGHT)} title={value}>
        {value}
      </p>
    </div>
  );
}
