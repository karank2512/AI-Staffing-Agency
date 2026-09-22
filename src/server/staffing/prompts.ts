import { JOB_FAMILIES, JOB_FAMILY_INFO, MAX_FOLLOW_UP_QUESTIONS, type IntakeAnswers, type JobFamily, type JobSpec } from "@/server/domain";
import { tools } from "@/server/tools";

/**
 * Prompts for the live (real-model) scoping and design calls. The mock path never reads these; they exist so
 * a real model is told exactly what the code will validate afterwards (snake_case names, registry tool names,
 * cadence semantics), which keeps the single re-ask in the model layer rare.
 */

function familyList(): string {
  return JOB_FAMILIES.map((slug) => `- ${slug}: ${JOB_FAMILY_INFO[slug].description} (default deliverable: ${JOB_FAMILY_INFO[slug].defaultDeliverableFormat})`).join("\n");
}

function toolList(): string {
  return tools
    .list()
    .map((t) => `- ${t.name} (${t.category}${t.defaultRequiresApproval ? ", needs human approval" : ""}): ${t.humanDescription}`)
    .join("\n");
}

function intakeBlock(intake: IntakeAnswers | null): string {
  if (!intake || intake.questions.length === 0) return "";
  const lines = ["", "## Follow-up answers"];
  for (const question of intake.questions) {
    const answer = intake.answers[question.id]?.trim();
    lines.push(`- Q: ${question.question}\n  A: ${answer && answer.length > 0 ? answer : "(skipped)"}`);
  }
  return lines.join("\n");
}

// ── Scoping questions (fast tier) ───────────────────────────────────────────

export const SCOPING_QUESTIONS_SYSTEM = [
  "You are the intake lead at a staffing agency for AI workers. A customer has described a recurring job in plain English.",
  `Classify it into one job family, propose a working title, and ask at most ${MAX_FOLLOW_UP_QUESTIONS} follow-up questions — only the ones whose answers would materially change how the job is specified (volume, focus, recipients, format, cadence, sources). Ask nothing the description already answers (a named region, stage, count, cadence, format or recipient is answered); an empty list is a valid answer.`,
  "The title is a short noun phrase of at most 60 characters that names the job, e.g. 'European Series A Fintech Lead List' or 'Competitor Pricing Tracker' — never the customer's first sentence cut short.",
  "Each question has a snake_case id, a one-line question, a short 'why' the customer will see as helper text, and 2–5 concrete quick-pick suggestions written as answers, not categories — reuse the customer's own words where they help.",
].join("\n");

export function buildScopingQuestionsPrompt(description: string, familyHint: JobFamily): string {
  return [
    "## Job families",
    familyList(),
    "",
    `A keyword heuristic suggests the family "${familyHint}"; override it when the description clearly says otherwise.`,
    "",
    "## Customer description",
    description.trim(),
  ].join("\n");
}

// ── Job spec (standard tier) ────────────────────────────────────────────────

export const SPEC_SYSTEM = [
  "You are a senior staffing manager writing the job specification for an AI worker. The spec is what the customer approves and what the worker is designed and evaluated against, so it must be concrete, complete and faithful to what the customer asked for.",
  "Rules for the spec object:",
  "- title: a short noun phrase naming the job (at most 60 chars; keep the working title unless it is clearly wrong). summary: one or two sentences a manager would use. objective: one clear paragraph.",
  "- responsibilities: 1–8 short imperative lines. inputs: up to 8, each with source web | provided_data | user_instruction | previous_runs.",
  "- deliverable.fields: snake_case names (letters, digits, underscores; no spaces), each with a description and required flag; up to 20. When the customer lists the columns they want, those ARE the fields, in their order (plus a source_url for research jobs); never replace them with a generic set. Mark required only what every record must have. deliverable.sections: for markdown reports only, 2–6 headings the report must contain (first one narrative such as 'Summary', one that is a list such as 'Top rounds', optionally one aggregate such as 'Category breakdown'); empty for csv/json.",
  "- deliverable.targetCount: a sensible number of records per run when the job is about records (the customer's number when they gave one); omit for pure prose.",
  "- cadence: parse it from the text — 'every morning' → daily hour 8; 'weekly on Monday' → weekly dayOfWeek 1 hour 9 (dayOfWeek 0 = Sunday); 'hourly' → hourly; 'on demand' → manual. Default weekly Monday 9 when unspecified. Hours are 0–23 in the customer's local time.",
  "- successCriteria: 1–8, each with a snake_case id, a description phrased as an outcome ('Every lead has a concrete fit reason'), and optional metric/target strings a reviewer can check.",
  "- toolsLikelyNeeded: only names from the tool registry below. Include send_notification only when the customer wants the result sent somewhere; then also list 'Sending the deliverable externally' under approvalPolicy.requireApprovalFor.",
  "- budget: only when the customer names a figure. constraints / outOfScope / assumptions: up to 10 each; write what is true, not filler.",
  "- Omit optional fields you have no value for. Never output null.",
].join("\n");

export function buildSpecPrompt(args: { description: string; title: string; jobFamily: JobFamily; intake: IntakeAnswers | null }): string {
  return [
    "## Job families",
    familyList(),
    "",
    "## Tool registry",
    toolList(),
    "",
    `## Working title: ${args.title}`,
    `## Suggested family: ${args.jobFamily} (keep it unless the description clearly belongs elsewhere)`,
    "",
    "## Customer description",
    args.description.trim(),
    intakeBlock(args.intake),
  ].join("\n");
}

// ── Blueprint draft (standard tier) ─────────────────────────────────────────

export const BLUEPRINT_SYSTEM = [
  "You are the Staffing Engine designing an AI worker for an approved job spec. You produce a flat draft; code turns it into the executable pipeline, so focus on the judgment calls: who the worker is, how each agent should work, which tools it needs, and which deterministic steps apply.",
  "The pipeline is fixed: a `collector` agent produces a JSON array of flat records with exactly the spec's field names → optional deterministic steps (validate required fields, dedupe on keyFields, rank by rankBy, compute stats by groupBy) → for markdown deliverables an `analyst` agent writes the narrative from the records (no tools) and code compiles the report; csv/json deliverables skip the analyst → optionally a notifier sends the result (approval-gated).",
  "Rules:",
  "- collector.instructions and analyst.instructions are full system prompts (300–900 words each): role, method step by step, the quality bar, output rules, and what to avoid — specific to THIS job, never generic.",
  "- tools: registry names only; the collector needs at least one way to get data (web_search + fetch_url + extract_data for the web, read_dataset for the workspace's records). The analyst has no tools. Do not give any agent send_notification — set steps.notify instead.",
  "- modelTier: fast for simple formatting, standard for research and categorization, reasoning only for genuinely hard analysis (it costs ~5× standard).",
  "- keyFields / rankBy / groupBy must be names from the spec's fields (empty string when none fits). rankBy should be numeric-like; groupBy categorical.",
  "- steps.validate should be true whenever there are required fields; steps.dedupe whenever a key field exists; steps.notify only when the spec asks for the result to be sent.",
  "- persona.name: a single human first name not in the used-names list; persona.title like 'AI Market Researcher'; persona.summary: 2–3 contractor-style sentences in the third person.",
  "- toolReasons: one plain-English reason per tool the worker uses, written for the customer. rationale: 3–6 bullets explaining the design the way a staffing manager would (why this tier, why these steps, what is deterministic and therefore free).",
].join("\n");

export function buildBlueprintPrompt(spec: JobSpec, usedNames: readonly string[]): string {
  return [
    "## Tool registry",
    toolList(),
    "",
    `## Names already in use (do not reuse): ${usedNames.length > 0 ? usedNames.join(", ") : "none"}`,
    "",
    "## Approved job spec",
    JSON.stringify(spec, null, 2),
  ].join("\n");
}
