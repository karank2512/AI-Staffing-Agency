import { JOB_FAMILIES, JobSpecSchema, type JobFamily, type JobSpec } from "@/server/domain";
import { mockJobSpec, mockScopingQuestions } from "@/server/staffing/scoping-mock";

/** Realistic descriptions per family; detectJobFamily must land on the intended family for each. */
export const DESCRIPTIONS: Record<JobFamily, string> = {
  market_research: "I need someone to track newly funded AI infrastructure startups every week and write a short market research report on what changed.",
  market_analysis: "Analyze the pricing and positioning of our top competitors and give me a benchmark with recommendations every Monday.",
  lead_research: "Build a list of 25 new outbound leads per week: Series A–B fintechs hiring a Head of Data, with a contact and why they fit our ICP.",
  feedback_analysis: "Categorize all the customer feedback and NPS survey responses we get each week by theme and sentiment, and tell me what to fix first.",
  support_triage: "Triage our inbound support tickets every morning: classify each one, set a priority and route it to the right team.",
  finance_ops: "Every week, categorize our vendor invoices and expenses, reconcile them against the budget and flag anything unusual.",
  content: "Write three LinkedIn posts a week for our developer audience, based on recent news about vector databases, with sources.",
  general: "Keep an eye on the things our operations team cares about and give me a short summary every week.",
};

export const FAMILIES: readonly JobFamily[] = JOB_FAMILIES;

/** A JobSpec for a family exactly as the simulated scoper would draft it, with optional overrides. */
export function specFor(family: JobFamily, overrides: Partial<JobSpec> = {}, answers: Record<string, string> = {}): JobSpec {
  const description = DESCRIPTIONS[family];
  const questions = mockScopingQuestions(description);
  const spec = mockJobSpec({
    description,
    title: questions.draftTitle,
    jobFamily: family,
    intake: { questions: questions.questions, answers },
  });
  return JobSpecSchema.parse({ ...spec, ...overrides, deliverable: { ...spec.deliverable, ...(overrides.deliverable ?? {}) } });
}

/** Descriptions customers actually typed (browser sessions, the Describe step's example chips and the demo seed). */
export const KAI =
  "Every weekday morning, research 15 Series A fintech companies in Europe that are hiring engineers. Give me a CSV with company, website, funding stage, headcount and a one-line reason each is a good fit for our developer tools.";
export const PRICING_MONITOR =
  "Every week, check the pricing pages of our five main competitors (Notion, Coda, Airtable, ClickUp, Monday). Capture plan name, monthly price, seat minimum and any change since last week, and flag anything that moved.";
export const FUNDING_TRACKER =
  "Track newly funded AI infrastructure startups every week. For each round capture the company, stage, amount, lead investor and a source link, rank the biggest rounds and write a short market research report on what changed.";
export const FEEDBACK_DIGEST =
  "Weekly customer feedback analysis with a Monday email to the product team. Every week, categorize all the customer feedback and NPS survey responses we received by theme and sentiment, tell us what to fix first, and email the summary to the product team on Monday morning.";
export const FINTECH_LEADS =
  "Build a weekly lead list of Series A fintech companies as a CSV. Each week, find 25 accounts with a likely decision-maker, why they fit our ICP, and a source for each, delivered as a CSV we can import into our CRM.";
export const SEED_PRICING_JOB =
  "Weekly competitor pricing check. Every Monday, analyze the pricing pages of our five closest competitors and tell me what changed — new plans, price moves, free-tier changes — with a clear recommendation for our own pricing.";

/** Scope any description exactly as the simulated scoper would (family, title, questions), with optional answers. */
export function scoped(description: string, answers: Record<string, string> = {}): JobSpec {
  const questions = mockScopingQuestions(description);
  return mockJobSpec({ description, title: questions.draftTitle, jobFamily: questions.jobFamily, intake: { questions: questions.questions, answers } });
}
