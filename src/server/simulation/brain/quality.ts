import type { ModelTier } from "@/server/domain/blueprint";
import { seededShuffle } from "../rng";
import { keywords } from "../text";

/**
 * The simulated QUALITY MODEL — why a badly designed worker performs measurably worse than a well designed
 * one even with no real LLM behind it (which is what gives the Replace flow something true to fix):
 *
 *   - `fast` tier collector      → ~30% of records lose one required field, and ~15% duplicates are appended
 *   - vague instructions (<120c) → ~40% fewer records than the target
 *   - standard / reasoning tier with specific instructions → complete records, sized to the target
 *
 * Everything is seeded (component id + spec title), so the same blueprint degrades the same way every run.
 */

export const DEFAULT_TARGET_COUNT = 12;
const VAGUE_INSTRUCTIONS_CHARS = 120;
const VAGUE_YIELD = 0.6;
const MISSING_FIELD_RATE = 0.3;
const DUPLICATE_RATE = 0.15;
const MAX_COUNT = 100;

// ── One-off instructions ────────────────────────────────────────────────────

export interface OneOffDirectives {
  /** "top 5", "only 8 leads", "give me ten companies" … */
  count?: number;
  /** What to filter/prioritise by: stemmed content words ("vector", "database") and stage phrases ("series a"). */
  focusTerms: string[];
  /** "only / just / exclusively" → keep ONLY matching records (when any match). */
  strict: boolean;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, fifty: 50,
};

const NUM = `(\\d{1,3}|${Object.keys(NUMBER_WORDS).join("|")})`;
const NOT_A_DURATION = "(?!\\s*(?:-\\s*)?(?:days?|weeks?|months?|hours?|years?|minutes?|%|percent|k\\b|m\\b|usd|dollars?))";
const COUNTABLE = "(?:leads?|compan(?:y|ies)|records?|items?|startups?|results?|rows?|tickets?|entries|accounts?|prospects?|rounds?|deals?|reviews?|examples?|contacts?|comments?|vendors?|competitors?)";

const COUNT_PATTERNS: readonly RegExp[] = [
  new RegExp(`\\btop[-\\s]+${NUM}\\b${NOT_A_DURATION}`, "i"),
  new RegExp(`\\b(?:only|just|exactly|at most|up to|no more than|limit(?:ed)? to|first|give me|return|find|include|need|want|send me|keep)\\s+(?:the\\s+)?(?:top\\s+|best\\s+)?${NUM}\\b${NOT_A_DURATION}`, "i"),
  new RegExp(`\\b${NUM}\\s+(?:[a-z-]+\\s+){0,2}?${COUNTABLE}\\b`, "i"),
];

/** Words that express the instruction itself rather than what to focus on. */
const INSTRUCTION_WORDS = new Set(
  (
    "focus focu only just exclusively top best first give return find include need want send keep limit limited most exactly " +
    "please prioritize prioritise priority emphasize emphasise highlight look cover add report run time week month today this " +
    "lead company record item startup result row ticket entry account prospect round deal review example contact comment vendor " +
    "competitor list make sure ensure skip ignore exclude use show tell get one more less than least number count data information " +
    "thing stuff anything everything related relevant about regarding around especially particularly mainly mostly really very " +
    "next last new latest recent recently also well want like would could should"
  ).split(" "),
);

function parseCount(text: string): number | undefined {
  for (const pattern of COUNT_PATTERNS) {
    const m = pattern.exec(text);
    if (!m) continue;
    const raw = m[1].toLowerCase();
    const n = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
    if (Number.isFinite(n) && n >= 1) return Math.min(MAX_COUNT, n);
  }
  return undefined;
}

/** Funding stages are phrases ("series a"); matching the bare word "series" would hit every later-stage round. */
const STAGE_PHRASE = /\b(pre[-\s]?seed|seed|series\s+[a-e])\b/gi;

export function parseOneOffInstructions(instructions: readonly string[]): OneOffDirectives {
  const text = instructions.filter((s) => typeof s === "string").join(". ");
  const numberWords = new Set(Object.keys(NUMBER_WORDS));
  const stagePhrases = [...new Set([...text.matchAll(STAGE_PHRASE)].map((m) => m[1].toLowerCase().replace(/[-\s]+/g, " ")))];
  const words = keywords(text.replace(STAGE_PHRASE, " "), INSTRUCTION_WORDS).filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !numberWords.has(t));
  const focusTerms = [...stagePhrases, ...words].slice(0, 8);
  return {
    count: parseCount(text),
    focusTerms,
    strict: /\b(only|just|exclusively|nothing but|solely)\b/i.test(text) && focusTerms.length > 0,
  };
}

// ── Sizing + degradation ────────────────────────────────────────────────────

export function hasVagueInstructions(instructions: string): boolean {
  return instructions.trim().length < VAGUE_INSTRUCTIONS_CHARS;
}

/** An explicit request from the user ("top 5") always wins; otherwise vague system prompts under-deliver. */
export function desiredRecordCount(args: { explicit?: number; target: number; vague: boolean }): number {
  if (args.explicit !== undefined) return Math.max(1, Math.min(MAX_COUNT, args.explicit));
  const base = Math.max(1, Math.min(MAX_COUNT, args.target));
  return args.vague ? Math.max(1, Math.round(base * VAGUE_YIELD)) : base;
}

export function degradeForTier(
  records: Array<Record<string, unknown>>,
  args: { tier: ModelTier; requiredFields: readonly string[]; seed: number },
): Array<Record<string, unknown>> {
  if (args.tier !== "fast" || records.length < 3) return records;
  const n = records.length;
  const out = records.map((r) => ({ ...r }));

  // Sloppy extraction: blank ONE required field. The identifying (first) field is spared when there is a
  // choice, so the row is still recognisable in the deliverable ("Vectorloom — stage missing").
  const candidates = args.requiredFields.length > 1 ? args.requiredFields.slice(1) : args.requiredFields;
  if (candidates.length > 0) {
    const victims = seededShuffle(out.map((_, i) => i), args.seed).slice(0, Math.max(1, Math.round(n * MISSING_FIELD_RATE)));
    victims.forEach((index, k) => {
      const present = candidates.filter((f) => f in out[index]);
      if (present.length > 0) out[index][present[(args.seed + k) % present.length]] = null;
    });
  }

  // Careless re-reading of the same source: repeat some rows verbatim.
  const repeats = seededShuffle(records.map((_, i) => i), args.seed ^ 0x9e3779b9).slice(0, Math.max(1, Math.round(n * DUPLICATE_RATE)));
  for (const index of repeats) out.push({ ...records[index] });
  return out;
}
