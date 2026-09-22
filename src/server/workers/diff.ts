import {
  describeCadence,
  type BlueprintComponent,
  type BlueprintDiff,
  type BlueprintDiffEntry,
  type DeterministicCheck,
  type Kpi,
  type RubricCriterion,
  type WorkerBlueprint,
} from "@/server/domain";
import { oneLine } from "./shared";

/**
 * diffBlueprints — PURE, human-labelled comparison of two blueprints for the version-compare page. Entries come
 * out in a stable order (persona → responsibilities → pipeline → tools → KPIs → evaluation → deliverable →
 * schedule → limits → cost) so the same pair always renders the same list.
 */

const EXCERPT_CHARS = 120;
const EXCERPT_LEAD = 30;

type Entries = BlueprintDiffEntry[];

const money = (n: number) => `$${n.toFixed(n > 0 && n < 0.01 ? 4 : 2)}`;
const list = (items: readonly string[]) => (items.length > 0 ? items.join(", ") : "none");
const bullets = (items: readonly string[]) => items.map((s) => `• ${s}`).join("\n");
const json = (value: unknown) => JSON.stringify(value);

/**
 * Two windows around the first character that differs, so an instruction with a paragraph appended shows the
 * appended text rather than two identical openings.
 */
export function changeExcerpt(before: string, after: string): { before: string; after: string } {
  const a = oneLine(before);
  const b = oneLine(after);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const start = Math.max(0, i - EXCERPT_LEAD);
  const window = (text: string) => {
    const slice = text.slice(start, start + EXCERPT_CHARS);
    return `${start > 0 ? "…" : ""}${slice}${start + EXCERPT_CHARS < text.length ? "…" : ""}`;
  };
  return { before: window(a), after: window(b) };
}

function changed(entries: Entries, path: string, label: string, before: unknown, after: unknown, render: (v: unknown) => string = String): void {
  if (json(before) === json(after)) return;
  entries.push({ path, label, kind: "changed", before: render(before), after: render(after) });
}

function componentSummary(c: BlueprintComponent): string {
  if (c.type === "agent") {
    return `agent · ${c.modelTier} tier · tools: ${list(c.tools)} · up to ${c.maxTurns} turns · writes ${c.outputKey}`;
  }
  return `${c.operation.replace(/_/g, " ")} · ${json(c.config)} · writes ${c.outputKey}`;
}

function diffComponent(entries: Entries, before: BlueprintComponent, after: BlueprintComponent): void {
  const path = `components.${before.id}`;
  const name = after.name;
  changed(entries, `${path}.name`, `${before.name} · name`, before.name, after.name);
  if (before.type !== after.type) {
    entries.push({ path, label: `${name} · kind`, kind: "changed", before: componentSummary(before), after: componentSummary(after) });
    return;
  }
  if (before.type === "agent" && after.type === "agent") {
    if (before.instructions !== after.instructions) {
      const excerpt = changeExcerpt(before.instructions, after.instructions);
      entries.push({ path: `${path}.instructions`, label: `${name} · instructions`, kind: "changed", ...excerpt });
    }
    changed(entries, `${path}.goal`, `${name} · goal`, before.goal, after.goal);
    changed(entries, `${path}.modelTier`, `${name} · model tier`, before.modelTier, after.modelTier);
    changed(entries, `${path}.tools`, `${name} · tools`, before.tools, after.tools, (v) => list(v as string[]));
    changed(entries, `${path}.maxTurns`, `${name} · max turns`, before.maxTurns, after.maxTurns);
    changed(entries, `${path}.outputFormat`, `${name} · output format`, before.outputFormat, after.outputFormat);
    changed(entries, `${path}.outputSchemaHint`, `${name} · output shape`, before.outputSchemaHint ?? "", after.outputSchemaHint ?? "");
  } else if (before.type === "deterministic" && after.type === "deterministic") {
    changed(entries, `${path}.operation`, `${name} · operation`, before.operation, after.operation, (v) => String(v).replace(/_/g, " "));
    changed(entries, `${path}.config`, `${name} · configuration`, before.config, after.config, json);
  }
  changed(entries, `${path}.inputKeys`, `${name} · reads`, before.inputKeys, after.inputKeys, (v) => list(v as string[]));
  changed(entries, `${path}.outputKey`, `${name} · writes`, before.outputKey, after.outputKey);
}

function diffComponents(entries: Entries, before: WorkerBlueprint, after: WorkerBlueprint): void {
  const beforeById = new Map(before.components.map((c) => [c.id, c] as const));
  const afterById = new Map(after.components.map((c) => [c.id, c] as const));

  for (const c of before.components) {
    const next = afterById.get(c.id);
    if (!next) {
      entries.push({ path: `components.${c.id}`, label: `${c.name} · step removed`, kind: "removed", before: componentSummary(c) });
      continue;
    }
    diffComponent(entries, c, next);
  }
  for (const c of after.components) {
    if (beforeById.has(c.id)) continue;
    entries.push({ path: `components.${c.id}`, label: `${c.name} · step added`, kind: "added", after: componentSummary(c) });
  }

  const sharedBefore = before.components.filter((c) => afterById.has(c.id)).map((c) => c.id);
  const sharedAfter = after.components.filter((c) => beforeById.has(c.id)).map((c) => c.id);
  if (json(sharedBefore) !== json(sharedAfter)) {
    const order = (bp: WorkerBlueprint) => bp.components.map((c) => c.name).join(" → ");
    entries.push({ path: "components", label: "Pipeline order", kind: "changed", before: order(before), after: order(after) });
  }
}

function diffTools(entries: Entries, before: WorkerBlueprint, after: WorkerBlueprint): void {
  const beforeByName = new Map(before.tools.map((t) => [t.toolName, t] as const));
  const afterByName = new Map(after.tools.map((t) => [t.toolName, t] as const));
  const approval = (v: boolean) => (v ? "approval required" : "no approval needed");
  for (const t of before.tools) {
    const next = afterByName.get(t.toolName);
    if (!next) {
      entries.push({ path: `tools.${t.toolName}`, label: `Tools · ${t.toolName}`, kind: "removed", before: `${approval(t.requiresApproval)} — ${t.reason}` });
      continue;
    }
    changed(entries, `tools.${t.toolName}.requiresApproval`, `Tools · ${t.toolName} · approval`, t.requiresApproval, next.requiresApproval, (v) => approval(Boolean(v)));
  }
  for (const t of after.tools) {
    if (beforeByName.has(t.toolName)) continue;
    entries.push({ path: `tools.${t.toolName}`, label: `Tools · ${t.toolName}`, kind: "added", after: `${approval(t.requiresApproval)} — ${t.reason}` });
  }
}

function kpiSummary(k: Kpi): string {
  const target = k.unit === "%" ? `${Math.round(k.target * 100)}%` : k.unit === "$" ? money(k.target) : `${k.target} ${k.unit}`.trim();
  return `${target} (${k.direction === "higher_is_better" ? "higher is better" : "lower is better"})`;
}

function diffKpis(entries: Entries, before: WorkerBlueprint, after: WorkerBlueprint): void {
  const afterById = new Map(after.kpis.map((k) => [k.id, k] as const));
  const beforeById = new Map(before.kpis.map((k) => [k.id, k] as const));
  for (const k of before.kpis) {
    const next = afterById.get(k.id);
    if (!next) {
      entries.push({ path: `kpis.${k.id}`, label: `KPI · ${k.name}`, kind: "removed", before: kpiSummary(k) });
      continue;
    }
    changed(entries, `kpis.${k.id}`, `KPI · ${next.name}`, kpiSummary(k), kpiSummary(next));
  }
  for (const k of after.kpis) {
    if (beforeById.has(k.id)) continue;
    entries.push({ path: `kpis.${k.id}`, label: `KPI · ${k.name}`, kind: "added", after: kpiSummary(k) });
  }
}

const checkSummary = (c: DeterministicCheck) => `${c.description} · ${json(c.config)} · weight ${c.weight}`;
const rubricSummary = (r: RubricCriterion) => `${r.description} · weight ${r.weight}`;

function diffEvaluation(entries: Entries, before: WorkerBlueprint, after: WorkerBlueprint): void {
  const b = before.evaluation;
  const a = after.evaluation;

  const afterChecks = new Map(a.deterministicChecks.map((c) => [c.id, c] as const));
  const beforeChecks = new Map(b.deterministicChecks.map((c) => [c.id, c] as const));
  for (const c of b.deterministicChecks) {
    const next = afterChecks.get(c.id);
    if (!next) {
      entries.push({ path: `evaluation.checks.${c.id}`, label: `Check · ${c.type.replace(/_/g, " ")}`, kind: "removed", before: checkSummary(c) });
      continue;
    }
    changed(entries, `evaluation.checks.${c.id}`, `Check · ${next.type.replace(/_/g, " ")}`, checkSummary(c), checkSummary(next));
  }
  for (const c of a.deterministicChecks) {
    if (beforeChecks.has(c.id)) continue;
    entries.push({ path: `evaluation.checks.${c.id}`, label: `Check · ${c.type.replace(/_/g, " ")}`, kind: "added", after: checkSummary(c) });
  }

  const afterRubric = new Map(a.rubric.map((r) => [r.id, r] as const));
  const beforeRubric = new Map(b.rubric.map((r) => [r.id, r] as const));
  for (const r of b.rubric) {
    const next = afterRubric.get(r.id);
    if (!next) {
      entries.push({ path: `evaluation.rubric.${r.id}`, label: `Rubric · ${r.criterion}`, kind: "removed", before: rubricSummary(r) });
      continue;
    }
    changed(entries, `evaluation.rubric.${r.id}`, `Rubric · ${next.criterion}`, rubricSummary(r), rubricSummary(next));
  }
  for (const r of a.rubric) {
    if (beforeRubric.has(r.id)) continue;
    entries.push({ path: `evaluation.rubric.${r.id}`, label: `Rubric · ${r.criterion}`, kind: "added", after: rubricSummary(r) });
  }

  const weights = (w: typeof b.weights) => `checks ${w.deterministic} · reviewer ${w.judge} · you ${w.user}`;
  changed(entries, "evaluation.weights", "Evaluation · weights", b.weights, a.weights, (v) => weights(v as typeof b.weights));
  changed(entries, "evaluation.passThreshold", "Evaluation · pass mark", b.passThreshold, a.passThreshold, (v) => `${Math.round(Number(v) * 100)}/100`);
}

export function diffBlueprints(before: WorkerBlueprint, after: WorkerBlueprint): BlueprintDiff {
  const entries: Entries = [];

  changed(entries, "persona.name", "Persona · name", before.persona.name, after.persona.name);
  changed(entries, "persona.title", "Persona · title", before.persona.title, after.persona.title);
  changed(entries, "persona.summary", "Persona · summary", before.persona.summary, after.persona.summary);
  changed(entries, "responsibilities", "Responsibilities", before.responsibilities, after.responsibilities, (v) => bullets(v as string[]));

  diffComponents(entries, before, after);
  diffTools(entries, before, after);
  diffKpis(entries, before, after);
  diffEvaluation(entries, before, after);

  changed(entries, "deliverable.titleTemplate", "Deliverable · title", before.deliverable.titleTemplate, after.deliverable.titleTemplate);
  changed(entries, "deliverable.format", "Deliverable · format", before.deliverable.format, after.deliverable.format);
  changed(entries, "deliverable.contentKey", "Deliverable · content source", before.deliverable.contentKey, after.deliverable.contentKey);
  changed(entries, "deliverable.dataKey", "Deliverable · records source", before.deliverable.dataKey ?? "none", after.deliverable.dataKey ?? "none");

  changed(entries, "schedule", "Schedule", before.schedule, after.schedule, (v) => describeCadence(v as WorkerBlueprint["schedule"]));

  changed(entries, "limits.maxCostPerRunUsd", "Limits · max cost per run", before.limits.maxCostPerRunUsd, after.limits.maxCostPerRunUsd, (v) => money(Number(v)));
  changed(entries, "limits.maxToolCallsPerRun", "Limits · max tool calls per run", before.limits.maxToolCallsPerRun, after.limits.maxToolCallsPerRun);
  changed(entries, "limits.maxRunDurationSec", "Limits · max run duration", before.limits.maxRunDurationSec, after.limits.maxRunDurationSec, (v) => `${v}s`);

  changed(entries, "costEstimate.perRunUsd", "Estimated cost · per run", before.costEstimate.perRunUsd, after.costEstimate.perRunUsd, (v) => money(Number(v)));
  changed(entries, "costEstimate.monthlyUsd", "Estimated cost · per month", before.costEstimate.monthlyUsd, after.costEstimate.monthlyUsd, (v) => money(Number(v)));

  return { entries };
}
