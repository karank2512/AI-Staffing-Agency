import { BLUEPRINT_CHANGE_AREAS, renderJobBrief, type JobSpec, type ModelTier, type WorkerBlueprint } from "@/server/domain";
import type { ReplacementEvidence } from "./replace-evidence";
import { clip } from "./shared";

/**
 * Live-mode replacement planning: the prompt the reasoning model sees and the normalizer that clamps its output
 * to what applyReplacementPlan can use (known agent ids, bounded arrays, sane numbers).
 */

const TIERS: readonly ModelTier[] = ["fast", "standard", "reasoning"];
const AREAS = new Set<string>(BLUEPRINT_CHANGE_AREAS);
const SEVERITIES = new Set(["low", "medium", "high"]);
const INSTRUCTION_EXCERPT = 600;

export const PLAN_SYSTEM = [
  "You are the staffing lead at an agency that supplies AI workers. A worker is under-performing and the customer asked for a replacement. Study the worker's current design and its record, then propose a replacement design as JSON only.",
  "Rules:",
  "- Ground every failure pattern in the evidence (counts, quoted feedback, quoted errors). Do not invent incidents.",
  "- Prefer deterministic fixes (validation, de-duplication) over prompt tweaks; use a bigger model tier only when the evidence shows the model itself is the weak link.",
  "- instructionRewrites are complete system prompts for the named agent component (method, quality bar, output contract), not diffs.",
  "- Only reference component ids that exist. Keep arrays within their limits.",
  "- estimatedDeltas are percentages versus the current version: positive qualityPct is better; positive costPct/latencyPct is more expensive/slower.",
].join("\n");

function compactBlueprint(bp: WorkerBlueprint): string {
  const lines: string[] = [];
  lines.push(`Persona: ${bp.persona.name}, ${bp.persona.title}`);
  lines.push(`Deliverable: ${bp.deliverable.format} · schedule ${bp.schedule.kind} · limits ${JSON.stringify(bp.limits)}`);
  lines.push(`Tools: ${bp.tools.map((t) => `${t.toolName}${t.requiresApproval ? " (approval)" : ""}`).join(", ") || "none"}`);
  lines.push("Pipeline:");
  for (const c of bp.components) {
    if (c.type === "agent") {
      lines.push(`- ${c.id} [agent] ${c.name} · ${c.modelTier} tier · tools: ${c.tools.join(", ") || "none"} · maxTurns ${c.maxTurns} · ${c.outputFormat} → ${c.outputKey}`);
      lines.push(`  instructions (${c.instructions.length} chars): ${clip(c.instructions, INSTRUCTION_EXCERPT)}`);
    } else {
      lines.push(`- ${c.id} [${c.operation}] ${c.name} · ${JSON.stringify(c.config)} → ${c.outputKey}`);
    }
  }
  lines.push(`Checks: ${bp.evaluation.deterministicChecks.map((c) => `${c.type} ${JSON.stringify(c.config)}`).join("; ") || "none"}`);
  lines.push(`KPIs: ${bp.kpis.map((k) => `${k.name} target ${k.target}${k.unit === "%" ? "" : ` ${k.unit}`}`).join("; ")}`);
  return lines.join("\n");
}

function renderEvidence(e: ReplacementEvidence): string {
  const lines: string[] = [];
  lines.push(`Window: last ${e.windowDays} days · ${e.runs} finished runs (${e.succeeded} succeeded, ${e.failed} failed) · ${e.evaluations} evaluations · ${e.rejectedDeliverables.length} deliverables rejected`);
  const m = e.metrics;
  lines.push(`Metrics: success rate ${fmt(m.successRate)} · acceptance rate ${fmt(m.acceptanceRate)} · avg reviewer score ${fmt(m.avgJudgeScore)} · avg checks score ${fmt(m.avgDeterministicScore)} · avg records/run ${m.avgRecordsPerRun ?? "n/a"} · avg cost/run ${m.avgCostPerRunUsd ?? "n/a"}`);
  if (e.recordShortfalls.min !== null) lines.push(`Record shortfalls: ${e.recordShortfalls.short} of ${e.recordShortfalls.withRecords} deliverables under the minimum of ${e.recordShortfalls.min} (average ${e.recordShortfalls.averageRecords ?? "n/a"})`);
  if (e.kpiMisses.length > 0) lines.push(`Missed KPIs: ${e.kpiMisses.map((k) => `${k.name} ${k.actual ?? "n/a"} vs ${k.target}`).join("; ")}`);
  if (e.failedRuns.length > 0) lines.push("Failed runs:", ...e.failedRuns.map((r) => `- ${r.at.slice(0, 10)}: ${clip(r.error, 200)}`));
  if (e.lowEvaluations.length > 0) lines.push("Evaluations below the pass mark:", ...e.lowEvaluations.map((x) => `- ${x.at.slice(0, 10)} ${x.type} ${Math.round(x.score * 100)}/100: ${clip(x.reasoning, 240)}`));
  if (e.rejectedDeliverables.length > 0) lines.push("Rejected deliverables:", ...e.rejectedDeliverables.map((d) => `- ${d.at.slice(0, 10)} “${clip(d.title, 80)}”: ${d.feedback ? clip(d.feedback, 240) : "no written feedback"}`));
  return lines.join("\n");
}

const fmt = (rate: number | null) => (rate === null ? "n/a" : `${Math.round(rate * 100)}%`);

export function planPrompt(args: { blueprint: WorkerBlueprint; spec: JobSpec; evidence: ReplacementEvidence }): string {
  return [
    `Worker: ${args.evidence.workerName} on “${args.evidence.jobTitle}”`,
    "",
    "## Job",
    clip(renderJobBrief(args.spec), 3_000),
    "",
    "## Current design",
    compactBlueprint(args.blueprint),
    "",
    "## Record",
    renderEvidence(args.evidence),
  ].join("\n");
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asString = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const clampNumber = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

/** Clamp a model's plan to the schema and to the blueprint it will be applied to. */
export function normalizePlan(agentIds: ReadonlySet<string>): (raw: unknown) => unknown {
  return (raw) => {
    if (!isRecord(raw)) return raw;
    const deltas = isRecord(raw.estimatedDeltas) ? raw.estimatedDeltas : {};
    const changes = asArray(raw.changes)
      .filter(isRecord)
      .map((c) => ({ area: AREAS.has(asString(c.area)) ? asString(c.area) : "instructions", description: asString(c.description), rationale: asString(c.rationale) }))
      .filter((c) => c.description.length > 0)
      .slice(0, 8);
    if (changes.length === 0) changes.push({ area: "instructions", description: "Refine the instructions around the evidence above.", rationale: "The model returned no explicit changes." });
    return {
      summary: asString(raw.summary),
      failurePatterns: asArray(raw.failurePatterns)
        .filter(isRecord)
        .map((p) => ({
          pattern: asString(p.pattern),
          evidence: asString(p.evidence),
          occurrences: Math.max(0, Math.round(clampNumber(p.occurrences, 0, 10_000, 0))),
          severity: SEVERITIES.has(asString(p.severity)) ? asString(p.severity) : "medium",
        }))
        .filter((p) => p.pattern.length > 0)
        .slice(0, 6),
      rootCauses: asArray(raw.rootCauses).filter((s): s is string => typeof s === "string" && s.trim().length > 0).slice(0, 6),
      changes,
      instructionRewrites: asArray(raw.instructionRewrites)
        .filter(isRecord)
        .filter((r) => agentIds.has(asString(r.componentId)) && asString(r.instructions).trim().length > 0)
        .map((r) => ({ componentId: asString(r.componentId), instructions: asString(r.instructions).trim() })),
      tierChanges: asArray(raw.tierChanges)
        .filter(isRecord)
        .filter((t) => agentIds.has(asString(t.componentId)) && TIERS.includes(asString(t.modelTier) as ModelTier))
        .map((t) => ({ componentId: asString(t.componentId), modelTier: asString(t.modelTier) })),
      addValidationStep: raw.addValidationStep === true,
      addDedupeStep: raw.addDedupeStep === true,
      estimatedDeltas: {
        qualityPct: clampNumber(deltas.qualityPct, -100, 300, 0),
        costPct: clampNumber(deltas.costPct, -100, 300, 0),
        latencyPct: clampNumber(deltas.latencyPct, -100, 300, 0),
      },
    };
  };
}
