import type { AgentComponent, BlueprintChange, FailurePattern, JobSpec, ModelTier, ReplacementPlan, WorkerBlueprint } from "@/server/domain";
import type { ReplacementEvidence } from "./replace-evidence";
import { clip, formatKpiValue, plural, quote, requiredSpecFields } from "./shared";

/**
 * Simulated-mode replacement plan. PURE and evidence-driven: every failure pattern quotes real counts and
 * feedback, and every change addresses something visible in the current blueprint (fast tier, missing cleaning
 * steps, thin instructions) so the proposal reads like a staffing lead who studied the record.
 */

export const THIN_INSTRUCTION_CHARS = 300;
const TIER_RANK: Record<ModelTier, number> = { fast: 0, standard: 1, reasoning: 2 };

const pct = (rate: number) => `${Math.round(rate * 100)}%`;
const severityByRate = (rate: number): FailurePattern["severity"] => (rate > 0.4 ? "high" : rate > 0.2 ? "medium" : "low");

function topError(evidence: ReplacementEvidence): string | null {
  const counts = new Map<string, number>();
  for (const run of evidence.failedRuns) counts.set(run.error, (counts.get(run.error) ?? 0) + 1);
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return best ? best[0] : null;
}

export function failurePatternsFrom(evidence: ReplacementEvidence): FailurePattern[] {
  const patterns: FailurePattern[] = [];
  const e = evidence;

  if (e.failed > 0) {
    const error = topError(e);
    patterns.push({
      pattern: `${e.failed} of ${plural(e.runs, "run")} failed`,
      evidence: error ? `Most common error: ${quote(error)}` : "The runs ended without a deliverable",
      occurrences: e.failed,
      severity: severityByRate(e.failed / Math.max(1, e.runs)),
    });
  }
  const rs = e.recordShortfalls;
  if (rs.min !== null && rs.short > 0) {
    patterns.push({
      pattern: `${rs.short} of ${plural(rs.withRecords, "run")} produced fewer than ${rs.min} records`,
      evidence: `Average of ${rs.averageRecords ?? 0} records per deliverable against a minimum of ${rs.min}`,
      occurrences: rs.short,
      severity: severityByRate(rs.short / Math.max(1, rs.withRecords)),
    });
  }
  if (e.rejectedDeliverables.length > 0) {
    const quotes = e.rejectedDeliverables.filter((d) => d.feedback).slice(0, 2).map((d) => `'${clip(d.feedback ?? "", 120)}'`);
    patterns.push({
      pattern: `${plural(e.rejectedDeliverables.length, "deliverable")} rejected${quotes.length > 0 ? `: ${quotes.join(", ")}` : ""}`,
      evidence: quotes.length > 0 ? `Your feedback on ${e.rejectedDeliverables.map((d) => `“${clip(d.title, 60)}”`).slice(0, 2).join(" and ")}` : "Sent back without written feedback",
      occurrences: e.rejectedDeliverables.length,
      severity: e.rejectedDeliverables.length >= 2 ? "high" : "medium",
    });
  }
  const judge = e.lowEvaluations.filter((x) => x.type === "LLM_JUDGE");
  if (judge.length > 0) {
    const avg = judge.reduce((s, x) => s + x.score, 0) / judge.length;
    patterns.push({
      pattern: `${plural(judge.length, "quality review")} scored below the ${Math.round(e.passThreshold * 100)}/100 pass mark (average ${Math.round(avg * 100)}/100)`,
      evidence: quote(judge[0].reasoning, 160),
      occurrences: judge.length,
      severity: severityByRate(judge.length / Math.max(1, e.succeeded)),
    });
  }
  const checks = e.lowEvaluations.filter((x) => x.type === "DETERMINISTIC");
  if (checks.length > 0) {
    patterns.push({
      pattern: `${plural(checks.length, "run")} failed the automated checks`,
      evidence: quote(checks[0].reasoning, 160),
      occurrences: checks.length,
      severity: severityByRate(checks.length / Math.max(1, e.succeeded)),
    });
  }
  if (e.kpiMisses.length > 0) {
    patterns.push({
      pattern: `${plural(e.kpiMisses.length, "KPI target")} missed`,
      evidence: e.kpiMisses.map((k) => `${k.name} at ${formatKpiValue(k.actual, k.unit)} vs target ${formatKpiValue(k.target, k.unit)}`).join("; "),
      occurrences: e.kpiMisses.length,
      severity: "medium",
    });
  }
  return patterns.slice(0, 6);
}

function feedbackQuotes(evidence: ReplacementEvidence): string[] {
  const quotes = evidence.rejectedDeliverables.map((d) => d.feedback).filter((f): f is string => !!f);
  if (quotes.length > 0) return quotes.slice(0, 3);
  return evidence.lowEvaluations.filter((x) => x.type === "LLM_JUDGE").map((x) => x.reasoning).slice(0, 2);
}

function methodSteps(agent: AgentComponent, spec: JobSpec): string[] {
  const fields = spec.deliverable.fields.map((f) => f.name);
  const required = requiredSpecFields(spec);
  const key = required[0] ?? fields[0];
  const steps: string[] = [];
  if (agent.tools.includes("read_dataset")) steps.push("Load the full dataset with read_dataset and work through every item — never sample or stop early.");
  if (agent.tools.includes("web_search")) steps.push(`Run 3–5 focused web_search queries that pair the topic (“${clip(spec.title, 60)}”) with recency terms such as “announced”, “this week” or “raised”, and note which results are primary sources.`);
  if (agent.tools.includes("fetch_url")) steps.push("Open the most credible results with fetch_url (company sites, press releases, reputable news). A search snippet alone is never a source.");
  if (agent.tools.includes("extract_data")) steps.push(`Turn each page into records with extract_data, asking for exactly these fields: ${fields.join(", ") || "the fields in the job brief"}.`);
  if (agent.tools.includes("calculator")) steps.push("Use calculator for every figure you derive; never do arithmetic in your head.");
  if (required.length > 0) {
    steps.push(`Before answering, check every record: ${required.join(", ")} must hold a real value (no “n/a”, no guesses). Drop anything you cannot source${key ? `, and keep exactly one record per ${key}` : ""}.`);
  } else {
    steps.push("Before answering, re-read every record against the job brief and drop anything vague, unsourced or repeated.");
  }
  if (spec.deliverable.targetCount) {
    const min = Math.max(1, Math.round(spec.deliverable.targetCount * 0.8));
    steps.push(`Aim for about ${spec.deliverable.targetCount} records; fewer than ${min} counts as a failed run, but padding with weak records is worse.`);
  }
  return steps;
}

export function rewriteCollectorInstructions(agent: AgentComponent, spec: JobSpec, blueprint: WorkerBlueprint, evidence: ReplacementEvidence): string {
  const fields = spec.deliverable.fields.map((f) => f.name);
  const quotes = feedbackQuotes(evidence);
  const lines = [
    `You are ${blueprint.persona.name}'s ${agent.name.toLowerCase()} for “${spec.title}”. ${agent.goal.trim().replace(/\.?$/, ".")}`,
    "",
    "Method:",
    ...methodSteps(agent, spec).map((step, i) => `${i + 1}. ${step}`),
  ];
  if (quotes.length > 0) {
    lines.push("", "Quality bar, in your manager's own words:", ...quotes.map((q) => `- ${quote(q, 200)}`));
  }
  lines.push(
    "",
    "Output:",
    fields.length > 0
      ? `- A JSON array of flat objects with exactly these keys: ${fields.join(", ")}. Use null only when a value genuinely cannot be found.`
      : "- A JSON array of flat objects, one per item, with consistent snake_case keys.",
    "- No prose before or after the JSON.",
  );
  return lines.join("\n");
}

export function rewriteAnalystInstructions(agent: AgentComponent, spec: JobSpec, evidence: ReplacementEvidence): string {
  const quotes = feedbackQuotes(evidence);
  const [first, ...rest] = spec.deliverable.sections.length > 0 ? spec.deliverable.sections : ["Summary"];
  const lines = [
    `You are the analyst for “${spec.title}”. ${agent.goal.trim().replace(/\.?$/, ".")} Your text is the first thing your manager reads.`,
    "",
    "Method:",
    "1. Lead with the two or three findings that matter most, each backed by a figure from the records (counts, amounts, shares).",
    "2. Name specific entities — companies, categories, themes — instead of generalities like “many” or “several”.",
    "3. Call out what is surprising or missing and what your manager should do about it.",
    "4. Stay under 250 words; no filler, no restating the brief.",
  ];
  if (quotes.length > 0) lines.push("", "Quality bar, in your manager's own words:", ...quotes.map((q) => `- ${quote(q, 200)}`));
  lines.push("", "Output rules:", `- Your text is inserted under the heading “${first}”; start directly with the prose.`);
  if (rest.length > 0) lines.push(`- Then add these sections in this order, each under a “### <heading>” heading: ${rest.join(" · ")}.`);
  lines.push("- The records table is appended automatically; cite specific rows, never reproduce the table.");
  return lines.join("\n");
}

const hasOperation = (bp: WorkerBlueprint, op: "validate_records" | "dedupe") => bp.components.some((c) => c.type === "deterministic" && c.operation === op);

export function mockReplacementPlan(blueprint: WorkerBlueprint, spec: JobSpec, evidence: ReplacementEvidence): ReplacementPlan {
  const agents = blueprint.components.filter((c): c is AgentComponent => c.type === "agent");
  const collector = agents.find((a) => a.outputFormat === "json");
  const analyst = agents.find((a) => a.outputFormat === "markdown" && a.tools.length === 0);
  const required = requiredSpecFields(spec);
  const feedback = feedbackQuotes(evidence);

  const changes: BlueprintChange[] = [];
  const rootCauses: string[] = [];
  const tierChanges: ReplacementPlan["tierChanges"] = [];
  const instructionRewrites: ReplacementPlan["instructionRewrites"] = [];
  let tierSteps = 0;

  if (collector && collector.modelTier === "fast") {
    tierChanges.push({ componentId: collector.id, modelTier: "standard" });
    tierSteps = TIER_RANK.standard - TIER_RANK.fast;
    rootCauses.push(`The ${collector.name} runs on the fast model tier, which skips fields and repeats entries under load.`);
    changes.push({
      area: "model",
      description: `Move the ${collector.name} from the fast to the standard model tier.`,
      rationale: "Complete, de-duplicated records need a model that follows the field contract reliably; the fast tier trades that for speed.",
    });
  }

  const addValidationStep = !hasOperation(blueprint, "validate_records") && required.length > 0;
  if (addValidationStep) {
    rootCauses.push(`Nothing checks that ${required.join(", ")} are filled before the deliverable is assembled.`);
    changes.push({
      area: "pipeline",
      description: `Add a validation step that drops records missing ${required.join(", ")}.`,
      rationale: "Incomplete rows reach the deliverable today; a deterministic check removes them for free before anyone sees them.",
    });
  }
  const addDedupeStep = !hasOperation(blueprint, "dedupe") && required.length > 0;
  if (addDedupeStep) {
    rootCauses.push(`Duplicates are never removed, so the same ${required[0]} can appear more than once.`);
    changes.push({
      area: "pipeline",
      description: `Add a de-duplication step keyed on ${required[0]}.`,
      rationale: "Repeated entries inflate the count and erode trust in every other row.",
    });
  }

  for (const agent of [collector, analyst]) {
    if (!agent) continue;
    const thin = agent.instructions.trim().length < THIN_INSTRUCTION_CHARS;
    if (!thin && feedback.length === 0) continue;
    const rewritten = agent === collector ? rewriteCollectorInstructions(agent, spec, blueprint, evidence) : rewriteAnalystInstructions(agent, spec, evidence);
    instructionRewrites.push({ componentId: agent.id, instructions: rewritten });
    if (thin) rootCauses.push(`The ${agent.name}'s instructions are ${agent.instructions.trim().length} characters — too thin to set a method or a quality bar.`);
    else rootCauses.push(`Your feedback (${quote(feedback[0], 90)}) was never folded back into the ${agent.name}'s instructions.`);
    changes.push({
      area: "instructions",
      description: `Rewrite the ${agent.name}'s instructions with a step-by-step method${feedback.length > 0 ? " and your feedback as the quality bar" : " and an explicit quality bar"}.`,
      rationale: thin ? "A one-line prompt leaves the method to chance on every run." : "The instructions should encode what you already told the worker was wrong.",
    });
  }

  if (changes.length === 0) {
    // Nothing structural to fix: still give the manager a concrete, reviewable improvement.
    const agent = collector ?? agents[0];
    if (agent) {
      const rewritten = agent.outputFormat === "json" ? rewriteCollectorInstructions(agent, spec, blueprint, evidence) : rewriteAnalystInstructions(agent, spec, evidence);
      instructionRewrites.push({ componentId: agent.id, instructions: rewritten });
    }
    rootCauses.push("The current instructions do not spell out a checkable method or quality bar.");
    changes.push({
      area: "instructions",
      description: agent ? `Rewrite the ${agent.name}'s instructions around an explicit method and output contract.` : "Review the pipeline against the job spec; it has no agent component to improve.",
      rationale: "Makes every run follow the same steps, so results stop depending on the model's mood.",
    });
  }

  const stepsAdded = (addValidationStep ? 1 : 0) + (addDedupeStep ? 1 : 0);
  const estimatedDeltas = {
    qualityPct: Math.min(35, 15 + 5 * (changes.length - 1) + (tierSteps > 0 ? 5 : 0)),
    costPct: tierSteps > 0 ? Math.min(40, 10 + 15 * tierSteps) : -5,
    latencyPct: Math.min(20, (tierSteps > 0 ? 15 : 5) + (stepsAdded > 0 ? 5 : 0)),
  };

  const summaryParts: string[] = [];
  if (tierSteps > 0 && collector) summaryParts.push(`move the ${collector.name} to the standard tier`);
  if (addValidationStep && addDedupeStep) summaryParts.push("add validation and de-duplication steps");
  else if (addValidationStep) summaryParts.push("add a validation step");
  else if (addDedupeStep) summaryParts.push("add a de-duplication step");
  if (instructionRewrites.length > 0) {
    summaryParts.push(`rewrite the ${instructionRewrites.map((r) => agents.find((a) => a.id === r.componentId)?.name ?? r.componentId).join(" and ")} instructions${feedback.length > 0 ? " around your feedback" : ""}`);
  }
  const headline = evidence.runs > 0 ? `${pct(evidence.succeeded / evidence.runs)} of ${plural(evidence.runs, "run")} succeeded in the last ${evidence.windowDays} days` : `no finished runs in the last ${evidence.windowDays} days`;
  const summary = `${capitalize(joinList(summaryParts))} — ${headline}${evidence.rejectedDeliverables.length > 0 ? `, ${plural(evidence.rejectedDeliverables.length, "deliverable")} sent back` : ""}.`;

  return {
    summary,
    failurePatterns: failurePatternsFrom(evidence),
    rootCauses: rootCauses.slice(0, 6),
    changes: changes.slice(0, 8),
    instructionRewrites,
    tierChanges,
    addValidationStep,
    addDedupeStep,
    estimatedDeltas,
  };
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "refresh the design";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
