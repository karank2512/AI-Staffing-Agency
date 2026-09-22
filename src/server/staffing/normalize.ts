import { JOB_FAMILIES, MAX_FOLLOW_UP_QUESTIONS, type JobFamily, type ModelTier } from "@/server/domain";
import { tools } from "@/server/tools";
import { toSnakeCase } from "./cues";

/**
 * Normalizers for structured model output, applied BEFORE schema validation on both the live and mock paths.
 * They clamp what providers do not enforce (array lengths, ids, name casing, tool names) and drop nulls, so a
 * mostly-right answer validates instead of burning the single re-ask. Idempotent on already-valid data.
 */

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);
const strList = (v: unknown, max: number): string[] => (Array.isArray(v) ? v.map(str).filter((s): s is string => typeof s === "string" && s.trim().length > 0) : []).slice(0, max);
const bool = (v: unknown, fallback = false): boolean => (typeof v === "boolean" ? v : typeof v === "string" ? /^(true|yes|1)$/i.test(v) : fallback);
const num = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const family = (v: unknown, fallback: JobFamily): JobFamily => {
  const slug = str(v)?.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (JOB_FAMILIES as readonly string[]).includes(slug ?? "") ? (slug as JobFamily) : fallback;
};
const tier = (v: unknown): ModelTier => {
  const t = str(v)?.trim().toLowerCase();
  return t === "fast" || t === "reasoning" ? t : "standard";
};

/** Drop `undefined` and `null` properties so `.optional()` fields validate. */
function compact<T extends Rec>(o: T): T {
  const out: Rec = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) out[k] = v;
  return out as T;
}

function uniqueIds(items: Rec[], prefix: string): Rec[] {
  const taken = new Set<string>();
  return items.map((item, i) => {
    const base = toSnakeCase(str(item.id) ?? "") || `${prefix}_${i + 1}`;
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
    taken.add(id);
    return { ...item, id };
  });
}

// ── ScopingQuestions ────────────────────────────────────────────────────────

export function normalizeScopingQuestions(familyHint: JobFamily): (raw: unknown) => unknown {
  return (raw) => {
    if (!isRec(raw)) return raw;
    const questions = (Array.isArray(raw.questions) ? raw.questions : [])
      .filter(isRec)
      .map((q) =>
        compact({
          id: str(q.id),
          question: str(q.question)?.trim(),
          why: str(q.why)?.trim() || undefined,
          placeholder: str(q.placeholder)?.trim() || undefined,
          suggestions: strList(q.suggestions, 5).map((s) => s.trim()),
        }),
      )
      .filter((q) => (q.question?.length ?? 0) >= 5)
      .slice(0, MAX_FOLLOW_UP_QUESTIONS);
    return {
      draftTitle: str(raw.draftTitle)?.replace(/\s+/g, " ").trim().slice(0, 120),
      jobFamily: family(raw.jobFamily, familyHint),
      questions: uniqueIds(questions, "q"),
    };
  };
}

// ── JobSpec (LLM shape, without schemaVersion) ──────────────────────────────

const CADENCE_KINDS = new Set(["manual", "hourly", "daily", "weekly"]);

function normalizeCadence(v: unknown): Rec {
  if (!isRec(v)) return { kind: "weekly", hour: 9, dayOfWeek: 1 };
  const kind = str(v.kind)?.trim().toLowerCase();
  const hour = num(v.hour);
  const dow = num(v.dayOfWeek);
  return compact({
    kind: kind && CADENCE_KINDS.has(kind) ? kind : "weekly",
    hour: hour !== undefined ? Math.min(23, Math.max(0, Math.round(hour))) : undefined,
    dayOfWeek: dow !== undefined ? Math.min(6, Math.max(0, Math.round(dow))) : undefined,
  });
}

export function normalizeJobSpecLlm(familyHint: JobFamily): (raw: unknown) => unknown {
  return (raw) => {
    if (!isRec(raw)) return raw;
    const deliverable = isRec(raw.deliverable) ? raw.deliverable : {};
    const format = str(deliverable.format)?.trim().toLowerCase();
    const fields = (Array.isArray(deliverable.fields) ? deliverable.fields : [])
      .filter(isRec)
      .map((fld) => ({ name: toSnakeCase(str(fld.name) ?? ""), description: str(fld.description)?.trim() || str(fld.name)?.trim() || "", required: bool(fld.required) }))
      .filter((fld, i, all) => fld.name.length > 0 && all.findIndex((o) => o.name === fld.name) === i)
      .slice(0, 20);
    const targetCount = num(deliverable.targetCount);
    const inputs = (Array.isArray(raw.inputs) ? raw.inputs : [])
      .filter(isRec)
      .map((inp) => {
        const source = str(inp.source)?.trim().toLowerCase().replace(/[\s-]+/g, "_");
        return {
          name: str(inp.name)?.trim() ?? "",
          description: str(inp.description)?.trim() || str(inp.name)?.trim() || "",
          source: source === "provided_data" || source === "user_instruction" || source === "previous_runs" ? source : "web",
          required: bool(inp.required),
        };
      })
      .filter((inp) => inp.name.length > 0)
      .slice(0, 8);
    const criteria = uniqueIds(
      (Array.isArray(raw.successCriteria) ? raw.successCriteria : [])
        .filter(isRec)
        .map((c) => compact({ id: str(c.id), description: str(c.description)?.trim(), metric: str(c.metric)?.trim() || undefined, target: str(c.target)?.trim() || undefined }))
        .filter((c) => (c.description?.length ?? 0) > 0),
      "criterion",
    ).slice(0, 8);
    const approval = isRec(raw.approvalPolicy) ? raw.approvalPolicy : {};
    const budget = isRec(raw.budget) ? raw.budget : {};
    const perRun = num(budget.maxCostPerRunUsd);
    const monthly = num(budget.maxMonthlyUsd);

    return {
      title: str(raw.title)?.replace(/\s+/g, " ").trim().slice(0, 120),
      jobFamily: family(raw.jobFamily, familyHint),
      summary: str(raw.summary)?.trim(),
      objective: str(raw.objective)?.trim(),
      responsibilities: strList(raw.responsibilities, 8).map((s) => s.trim()),
      inputs,
      deliverable: compact({
        title: str(deliverable.title)?.trim(),
        description: str(deliverable.description)?.trim(),
        format: format === "csv" || format === "json" ? format : "markdown",
        fields,
        sections: format === "csv" || format === "json" ? [] : strList(deliverable.sections, 12).map((s) => s.trim()),
        targetCount: targetCount !== undefined && targetCount >= 1 ? Math.round(targetCount) : undefined,
      }),
      cadence: normalizeCadence(raw.cadence),
      successCriteria: criteria,
      constraints: strList(raw.constraints, 10),
      outOfScope: strList(raw.outOfScope, 10),
      toolsLikelyNeeded: [...new Set(strList(raw.toolsLikelyNeeded, 30).map((t) => t.trim().toLowerCase()).filter((t) => tools.has(t)))].slice(0, 12),
      approvalPolicy: compact({ requireApprovalFor: strList(approval.requireApprovalFor, 8), notes: str(approval.notes)?.trim() || undefined }),
      budget: compact({ maxCostPerRunUsd: perRun !== undefined && perRun > 0 ? perRun : undefined, maxMonthlyUsd: monthly !== undefined && monthly > 0 ? monthly : undefined }),
      assumptions: strList(raw.assumptions, 10),
    };
  };
}

// ── BlueprintDraft ──────────────────────────────────────────────────────────

function normalizeAgent(v: unknown, fallbackName: string): Rec {
  const a = isRec(v) ? v : {};
  return {
    name: str(a.name)?.trim() || fallbackName,
    description: str(a.description)?.trim() || `${fallbackName} for this job.`,
    goal: str(a.goal)?.trim() || `Do the ${fallbackName.toLowerCase()} work for this job.`,
    instructions: str(a.instructions)?.trim() ?? "",
    modelTier: tier(a.modelTier),
    tools: [...new Set(strList(a.tools, 20).map((t) => t.trim().toLowerCase()))],
  };
}

export function normalizeBlueprintDraft(raw: unknown): unknown {
  if (!isRec(raw)) return raw;
  const persona = isRec(raw.persona) ? raw.persona : {};
  const steps = isRec(raw.steps) ? raw.steps : {};
  const direction = str(raw.rankDirection)?.trim().toLowerCase();
  return {
    persona: { name: str(persona.name)?.trim() ?? "", title: str(persona.title)?.trim() ?? "", summary: str(persona.summary)?.trim() ?? "" },
    responsibilities: strList(raw.responsibilities, 8).map((s) => s.trim()),
    collector: normalizeAgent(raw.collector, "Collector"),
    analyst: normalizeAgent(raw.analyst, "Analyst"),
    steps: {
      validate: bool(steps.validate, true),
      dedupe: bool(steps.dedupe, true),
      rank: bool(steps.rank, false),
      computeStats: bool(steps.computeStats, false),
      notify: bool(steps.notify, false),
    },
    keyFields: strList(raw.keyFields, 5).map((s) => s.trim()),
    rankBy: str(raw.rankBy)?.trim() ?? "",
    rankDirection: direction === "asc" ? "asc" : "desc",
    groupBy: str(raw.groupBy)?.trim() ?? "",
    toolReasons: (Array.isArray(raw.toolReasons) ? raw.toolReasons : [])
      .filter(isRec)
      .map((r) => ({ toolName: str(r.toolName)?.trim().toLowerCase() ?? "", reason: str(r.reason)?.trim() ?? "" }))
      .filter((r) => r.toolName.length > 0 && r.reason.length > 0)
      .slice(0, 12),
    rationale: strList(raw.rationale, 8).map((s) => s.trim()),
  };
}
