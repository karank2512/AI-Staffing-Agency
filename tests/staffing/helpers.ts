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
