import type { RubricCriterion } from "@/server/domain/blueprint";
import type { JudgeOutput } from "@/server/domain/evaluation";
import type { DeliverableSignals } from "./signals";

/**
 * Simulated-mode judge. PURE and deterministic: every score is a function of measurable properties of the
 * deliverable (coverage, field completeness, duplicates, structure, depth and specificity of the prose), and
 * every reasoning sentence cites the observation behind it. A sloppy deliverable therefore scores visibly lower
 * than a clean one — which is what makes the Replace flow demonstrable without a live model.
 */

type SignalName = "coverage" | "completeness" | "uniqueness" | "structure" | "depth" | "specificity";

interface Assessment {
  /** 0..1, or null when the deliverable gives nothing to measure for this signal. */
  value: number | null;
  observation: string;
}

/** Prose length at which the write-up stops being "thin". */
const FULL_DEPTH_CHARS = 700;
const FULL_SPECIFICITY = { numbers: 6, entities: 4 };
/** Gaps hurt more than linearly: a report where 30% of rows are unusable is not "70% good". */
const INCOMPLETE_PENALTY = 2;
const DUPLICATE_PENALTY = 3;
const SCORE_FLOOR = 0.15;
const SCORE_SPAN = 0.8;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;

/** FNV-1a — evaluation must not depend on the simulation module for a 6-line hash. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function assessSignals(s: DeliverableSignals): Record<SignalName, Assessment> {
  const n = s.recordCount;

  const coverage: Assessment =
    n === null
      ? { value: null, observation: "" }
      : s.targetCount === null
        ? { value: n === 0 ? 0 : null, observation: n === 0 ? "It contains no records." : `It contains ${n} records.` }
        : {
            value: clamp01(n / s.targetCount),
            observation:
              n >= s.targetCount
                ? `It delivers ${n} records against a target of ${s.targetCount}.`
                : `It delivers only ${n} of the ${s.targetCount} records the job targets.`,
          };

  let completeness: Assessment = { value: null, observation: "" };
  if (n !== null && s.completeRecords !== null) {
    if (n === 0) {
      completeness = { value: 0, observation: "There are no records to carry the required fields." };
    } else {
      const rate = s.completeRecords / n;
      const fields = s.requiredFields.join(", ");
      completeness = {
        value: clamp01(1 - INCOMPLETE_PENALTY * (1 - rate)),
        observation:
          s.completeRecords === n
            ? `Every record has all required fields (${fields}).`
            : `Only ${pct(rate)} of records (${s.completeRecords} of ${n}) have every required field` +
              (s.worstField ? `; "${s.worstField.field}" is missing in ${s.worstField.missing}.` : "."),
      };
    }
  }

  let uniqueness: Assessment = { value: null, observation: "" };
  if (n !== null && n > 0 && s.duplicates !== null) {
    const example = s.duplicateExamples.length > 0 ? ` (e.g. ${s.duplicateExamples[0]})` : "";
    uniqueness = {
      value: clamp01(1 - DUPLICATE_PENALTY * (s.duplicates / n)),
      observation:
        s.duplicates === 0
          ? "There are no duplicate entries."
          : `${s.duplicates} of ${n} entries are duplicates${example}.`,
    };
  }

  const structure: Assessment =
    s.expectedSections.length === 0
      ? { value: null, observation: "" }
      : {
          value: 1 - s.missingSections.length / s.expectedSections.length,
          observation:
            s.missingSections.length === 0
              ? `All ${s.expectedSections.length} expected sections are present.`
              : `Expected section${s.missingSections.length === 1 ? "" : "s"} missing: ${s.missingSections.join(", ")}.`,
        };

  let depth: Assessment = { value: null, observation: "" };
  let specificity: Assessment = { value: null, observation: "" };
  if (s.narrativeChars !== null) {
    const chars = s.narrativeChars.toLocaleString("en-US");
    depth = {
      value: clamp01(s.narrativeChars / FULL_DEPTH_CHARS),
      observation:
        s.narrativeChars >= FULL_DEPTH_CHARS
          ? `The written analysis is substantive (~${chars} characters of prose).`
          : `The written analysis is thin (~${chars} characters of prose).`,
    };
    const named = s.entitiesMentioned.length;
    const examples = named > 0 ? ` (e.g. ${s.entitiesMentioned.slice(0, 3).join(", ")})` : "";
    specificity = {
      value:
        0.5 * clamp01(s.numbersMentioned / FULL_SPECIFICITY.numbers) + 0.5 * clamp01(named / FULL_SPECIFICITY.entities),
      observation:
        s.numbersMentioned === 0 && named === 0
          ? "It quotes no figures and names nothing from the underlying data."
          : `It quotes ${s.numbersMentioned} figure${s.numbersMentioned === 1 ? "" : "s"} and names ${named} item${named === 1 ? "" : "s"} from the data${examples}.`,
    };
  }

  return { coverage, completeness, uniqueness, structure, depth, specificity };
}

type Lens = Partial<Record<SignalName, number>>;

/** Which measurable signals speak to a rubric criterion, chosen from the words used to describe it. */
const LENSES: Array<{ pattern: RegExp; lens: Lens }> = [
  {
    pattern: /coverage|comprehensive|thorough|volume|breadth|enough|quantity|how many/,
    lens: { coverage: 0.6, completeness: 0.25, uniqueness: 0.15 },
  },
  {
    pattern: /insight|analy|trend|summar|actionab|specific|useful|recommend|takeaway|finding|narrative|depth|theme/,
    lens: { specificity: 0.35, depth: 0.25, structure: 0.1, completeness: 0.2, uniqueness: 0.1 },
  },
  {
    pattern: /clarity|clear|structur|format|readab|organi|presentation|concise|style|tone|layout/,
    lens: { structure: 0.5, depth: 0.2, specificity: 0.1, completeness: 0.2 },
  },
  {
    pattern: /accura|correct|relevan|sourc|cit(e|ation)|valid|reliab|trust|quality|complete|clean|duplicate|data|fit/,
    lens: { completeness: 0.5, uniqueness: 0.3, coverage: 0.2 },
  },
];
const DEFAULT_LENS: Lens = { coverage: 1, completeness: 1, uniqueness: 1, structure: 1, depth: 1, specificity: 1 };

function lensFor(criterion: RubricCriterion): Lens {
  // The id and name are the strongest hint; the description only breaks ties.
  const primary = `${criterion.id} ${criterion.criterion}`.toLowerCase();
  const secondary = criterion.description.toLowerCase();
  return (
    LENSES.find((l) => l.pattern.test(primary))?.lens ?? LENSES.find((l) => l.pattern.test(secondary))?.lens ?? DEFAULT_LENS
  );
}

function scoreCriterion(
  criterion: RubricCriterion,
  assessments: Record<SignalName, Assessment>,
  seed: string,
): { score: number; reasoning: string } {
  const lens = lensFor(criterion);
  const used = (Object.keys(lens) as SignalName[])
    .map((name) => ({ name, weight: lens[name] ?? 0, ...assessments[name] }))
    .filter((a): a is { name: SignalName; weight: number; value: number; observation: string } => a.value !== null);

  // A criterion whose own signals are all unmeasurable (e.g. "insight" on a CSV) falls back to everything we know.
  const basis =
    used.length > 0
      ? used
      : (Object.keys(assessments) as SignalName[])
          .map((name) => ({ name, weight: 1, ...assessments[name] }))
          .filter((a): a is { name: SignalName; weight: number; value: number; observation: string } => a.value !== null);

  if (basis.length === 0) {
    return { score: 0.5, reasoning: "The deliverable offers nothing measurable for this criterion, so it is scored neutrally." };
  }

  const totalWeight = basis.reduce((sum, a) => sum + a.weight, 0);
  const blend = basis.reduce((sum, a) => sum + a.value * a.weight, 0) / totalWeight;
  // ±0.015 of content-seeded variation keeps a run history from looking machine-stamped without changing verdicts.
  const jitter = ((hash(`${seed}:${criterion.id}`) % 31) - 15) / 1000;
  const score = Math.round(Math.min(0.97, Math.max(0.05, SCORE_FLOOR + SCORE_SPAN * blend + jitter)) * 100) / 100;

  // Lead with what moved the score most: weakest evidence first when the score is low, strongest otherwise.
  const ordered = [...basis].sort((a, b) => (score < 0.75 ? a.value - b.value : b.weight - a.weight));
  return { score, reasoning: ordered.slice(0, 3).map((a) => a.observation).join(" ") };
}

/** How much of a criterion's score survives records that break the brief: all at 100% fit, 35% at none. */
const FIT_FLOOR = 0.35;
const PRESENTATION = /clarity|clear|structur|format|readab|organi|presentation|concise|style|tone|layout/;

function fitObservation(fit: NonNullable<DeliverableSignals["constraintFit"]>): string {
  const brief = fit.labels.length > 0 ? ` (${fit.labels.join(", ")})` : "";
  const example = fit.examples.length > 0 ? `; e.g. ${fit.examples.join(", ")}` : "";
  return fit.fitting === 0
    ? `None of the ${fit.checked} records match the brief${brief}${example}.`
    : `Only ${fit.fitting} of ${fit.checked} records match the brief${brief}${example}.`;
}

/**
 * Records that break the brief's hard constraints ("Series A fintech in Europe") make the work wrong however
 * polished it is, so every criterion except pure presentation is scaled down by the share that fits.
 */
function applyConstraintFit(
  rubric: readonly RubricCriterion[],
  criteria: Array<{ id: string; score: number; reasoning: string }>,
  fit: DeliverableSignals["constraintFit"],
): { criteria: Array<{ id: string; score: number; reasoning: string }>; issue: string | null } {
  if (!fit || fit.checked === 0 || fit.fitting >= fit.checked) return { criteria, issue: null };
  const rate = fit.fitting / fit.checked;
  const factor = FIT_FLOOR + (1 - FIT_FLOOR) * rate;
  const observation = fitObservation(fit);
  return {
    issue: observation,
    criteria: criteria.map((c, i) => {
      const criterion = rubric[i];
      if (PRESENTATION.test(`${criterion.id} ${criterion.criterion}`.toLowerCase())) return c;
      return { ...c, score: Math.round(Math.max(0.05, c.score * factor) * 100) / 100, reasoning: `${observation} ${c.reasoning}`.trim() };
    }),
  };
}

export function mockJudgeOutput(rubric: readonly RubricCriterion[], signals: DeliverableSignals, seed: string): JudgeOutput {
  const assessments = assessSignals(signals);
  const scored = rubric.map((criterion) => ({ id: criterion.id, ...scoreCriterion(criterion, assessments, seed) }));
  const { criteria, issue } = applyConstraintFit(rubric, scored, signals.constraintFit);

  const totalWeight = rubric.reduce((sum, c) => sum + c.weight, 0);
  const overall = criteria.reduce((sum, c, i) => sum + c.score * rubric[i].weight, 0) / totalWeight;
  const ranked = criteria.map((c, i) => ({ ...c, name: rubric[i].criterion })).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];

  const verdict =
    overall >= 0.85
      ? "Strong work that meets the brief."
      : overall >= 0.7
        ? "Solid work with a few gaps."
        : overall >= 0.55
          ? "Usable, but it needs rework before it can be relied on."
          : "Below the bar for this job.";
  const spread =
    ranked.length > 1 && best.id !== worst.id
      ? ` Strongest on ${best.name} (${Math.round(best.score * 100)}/100), weakest on ${worst.name} (${Math.round(worst.score * 100)}/100).`
      : "";
  const weakest = (Object.values(assessments) as Assessment[])
    .filter((a): a is { value: number; observation: string } => a.value !== null)
    .sort((a, b) => a.value - b.value)[0];
  const focus = issue ? ` Main issue: ${issue}` : weakest && weakest.value < 0.8 ? ` Main issue: ${weakest.observation}` : "";

  return { criteria, overallReasoning: `${verdict}${spread}${focus}` };
}
