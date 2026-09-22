import {
  JOB_FAMILY_INFO,
  JobSpecSchema,
  detectJobFamily,
  type IntakeAnswers,
  type JobFamily,
  type JobSpec,
  type ScopingQuestions,
  type SpecInput,
} from "@/server/domain";
import { tools } from "@/server/tools";
import {
  CADENCE_ADJECTIVE,
  FAMILY_DEFAULT_CADENCE,
  clipText,
  detectBudget,
  detectCadence,
  detectCount,
  detectFormat,
  extractEmails,
  mentionsSending,
} from "./cues";
import { FAMILY_PROFILES } from "./families";

/**
 * The simulated scoper: deterministic follow-up questions and a JobSpec built from the description plus the
 * customer's answers. It reads the same cues a live model would be told to look for — counts, cadence words,
 * recipients, format words — so the spec visibly reflects what the customer said.
 */

const FILLER_PREFIX =
  /^(?:(?:hi|hello|hey)[,!.\s]+)?(?:please\s+)?(?:(?:i|we)\s+(?:need|want|would like|'d like|am looking for|are looking for|require)\s+)?(?:(?:an?|the)\s+)?(?:ai\s+)?(?:worker|agent|assistant|bot|someone|somebody|help)?\s*(?:to|that|who|which|can|will)?\s*(?:help\s+(?:me|us)\s+)?/i;

/** A working title from the first sentence, minus "I need someone to…" preambles. */
export function draftTitleFrom(description: string, family: JobFamily): string {
  const first = description.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+|\n/)[0] ?? "";
  const stripped = first.replace(FILLER_PREFIX, "").replace(/[.!?]+$/, "").trim();
  const candidate = stripped.length >= 8 ? stripped : first.trim();
  const title = clipText(candidate.charAt(0).toUpperCase() + candidate.slice(1), 80);
  return title.length >= 3 ? title : `${JOB_FAMILY_INFO[family].label} worker`;
}

export function mockScopingQuestions(description: string): ScopingQuestions {
  const jobFamily = detectJobFamily(description);
  return {
    draftTitle: draftTitleFrom(description, jobFamily),
    jobFamily,
    questions: FAMILY_PROFILES[jobFamily].questions.slice(0, 3),
  };
}

export interface MockSpecArgs {
  description: string;
  title: string;
  jobFamily: JobFamily;
  intake: IntakeAnswers | null;
}

/** Answers keyed by question id, trimmed, skipped ones removed. */
function answersOf(intake: IntakeAnswers | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, value] of Object.entries(intake?.answers ?? {})) {
    const clean = value.trim();
    if (clean.length > 0) out[id] = clean;
  }
  return out;
}

const KEEP_IN_WORKSPACE = /\b(just me|only me|in the workspace|workspace only|no(?:body| one) else|keep it here|i'?ll (?:import|download|pick it up))\b/i;

/** Which free-text answers become constraints ("Focus: …") and which describe an input source. */
const CONSTRAINT_ANSWERS: Record<string, string> = {
  focus: "Focus",
  icp: "Ideal customer profile",
  competitors: "Coverage",
  dimensions: "Emphasis",
  priorities: "Emphasis",
  rules: "Rules",
  categories: "Categories and teams",
  priority: "Priority rules",
  audience: "Audience and tone",
  outcome: "What a great result looks like",
};
const INPUT_ANSWERS: Record<string, { name: string; source: SpecInput["source"] }> = {
  sources: { name: "Sources", source: "provided_data" },
  competitors: { name: "Competitor list", source: "user_instruction" },
  icp: { name: "Ideal customer profile", source: "user_instruction" },
  rules: { name: "Categorization rules", source: "user_instruction" },
  audience: { name: "Content brief", source: "user_instruction" },
};

export function mockJobSpec(args: MockSpecArgs): JobSpec {
  const family = args.jobFamily;
  const profile = FAMILY_PROFILES[family];
  const answers = answersOf(args.intake);
  const everything = [args.description, ...Object.values(answers)].join("\n");

  // A direct answer to "how often?" wins over cadence words elsewhere; otherwise read everything the customer wrote.
  const impliedCadence = detectCadence([args.description, ...Object.values(answers)].join("\n"), FAMILY_DEFAULT_CADENCE[family]);
  const cadence = answers.cadence ? detectCadence(answers.cadence, impliedCadence) : impliedCadence;
  const format = detectFormat([answers.format ?? "", answers.recipients ?? "", args.description].join("\n"), JOB_FAMILY_INFO[family].defaultDeliverableFormat);
  const targetCount = detectCount(answers.volume ?? "") ?? detectCount(args.description) ?? profile.targetCount;

  const recipientsAnswer = answers.recipients ?? "";
  const emails = extractEmails(everything);
  const notify = !KEEP_IN_WORKSPACE.test(recipientsAnswer) && (emails.length > 0 || mentionsSending(recipientsAnswer) || mentionsSending(args.description));

  const constraints = [...profile.constraints];
  const inputs: SpecInput[] = [...profile.inputs];
  for (const [id, answer] of Object.entries(answers)) {
    const label = CONSTRAINT_ANSWERS[id];
    if (label) constraints.push(`${label}: ${clipText(answer, 200)}`);
    const input = INPUT_ANSWERS[id];
    if (input) {
      // The customer's own words beat the profile's generic description of the same input.
      const row: SpecInput = { name: input.name, description: clipText(answer, 200), source: input.source, required: true };
      const existing = inputs.findIndex((i) => i.name === input.name);
      if (existing >= 0) inputs[existing] = row;
      else inputs.push(row);
    }
  }

  const toolsLikelyNeeded = [...profile.tools, ...(notify ? ["send_notification"] : [])].filter((t) => tools.has(t));
  const requireApprovalFor = notify ? ["Sending the deliverable to anyone by email or Slack"] : [];
  const notes = notify
    ? emails.length > 0
      ? `Deliver to ${emails.join(", ")} after each run.`
      : `Deliver as requested: ${clipText(recipientsAnswer || "share it with the team", 120)}`
    : "Runs need no approvals; the deliverable waits for review in the workspace.";

  const objective = clipText(args.description, 600);
  const deliverableTitle = clipText(`${CADENCE_ADJECTIVE[cadence.kind]} ${profile.deliverableNoun}`, 120);
  const described = `${profile.deliverableDescription.charAt(0).toLowerCase()}${profile.deliverableDescription.slice(1)}`;
  const summary = `${JOB_FAMILY_INFO[family].workerTitle} who delivers ${cadence.kind === "manual" ? "an" : "a"} ${deliverableTitle.toLowerCase()}: ${described}`;

  const criteria = profile.successCriteria.map((c) => (c.metric === "Records per run" ? { ...c, target: `>= ${targetCount}` } : c));

  return JobSpecSchema.parse({
    schemaVersion: 1,
    title: clipText(args.title, 120),
    jobFamily: family,
    summary,
    objective: objective.length >= 10 ? objective : `${objective} — ${profile.deliverableDescription}`,
    responsibilities: profile.responsibilities.slice(0, 8),
    inputs: inputs.slice(0, 8),
    deliverable: {
      title: deliverableTitle,
      description: profile.deliverableDescription,
      format,
      fields: profile.fields,
      sections: format === "markdown" ? profile.sections : [],
      targetCount,
    },
    cadence,
    successCriteria: criteria.slice(0, 8),
    constraints: constraints.slice(0, 10),
    outOfScope: profile.outOfScope.slice(0, 10),
    toolsLikelyNeeded: toolsLikelyNeeded.slice(0, 12),
    approvalPolicy: { requireApprovalFor, notes },
    budget: detectBudget(everything),
    assumptions: profile.assumptions.slice(0, 10),
  });
}
