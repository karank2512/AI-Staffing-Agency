import { z } from "zod";

/**
 * Job families are the unit of the data flywheel: blueprints, KPIs and evaluation rubrics are
 * learned per family. The slug is stored on Job.jobFamily and inside JobSpec/WorkerBlueprint.
 */
export const JOB_FAMILIES = [
  "lead_research",
  "market_research",
  "market_analysis",
  "feedback_analysis",
  "support_triage",
  "finance_ops",
  "content",
  "general",
] as const;

export const JobFamilySchema = z.enum(JOB_FAMILIES);
export type JobFamily = z.infer<typeof JobFamilySchema>;

export interface JobFamilyInfo {
  slug: JobFamily;
  label: string;
  /** Default role title for workers hired into this family. */
  workerTitle: string;
  description: string;
  /** Lower-cased keywords used for heuristic detection (simulated mode + prompt hints). */
  keywords: string[];
  defaultDeliverableFormat: "markdown" | "csv" | "json";
}

export const JOB_FAMILY_INFO: Record<JobFamily, JobFamilyInfo> = {
  lead_research: {
    slug: "lead_research",
    label: "Lead Research",
    workerTitle: "AI Lead Researcher",
    description: "Builds and enriches lists of target accounts and contacts.",
    keywords: ["lead", "leads", "prospect", "prospects", "icp", "outbound", "account list", "enrich", "contacts", "sdr"],
    defaultDeliverableFormat: "csv",
  },
  market_research: {
    slug: "market_research",
    label: "Market Research",
    workerTitle: "AI Market Researcher",
    description: "Finds, tracks and summarizes companies, funding and market movements.",
    keywords: ["market research", "startups", "funding", "funded", "competitors", "landscape", "track companies", "research", "find companies"],
    defaultDeliverableFormat: "markdown",
  },
  market_analysis: {
    slug: "market_analysis",
    label: "Market Analysis",
    workerTitle: "AI Market Analyst",
    description: "Analyzes pricing, positioning and trends and produces recommendations.",
    keywords: ["analysis", "analyze", "pricing", "trend", "trends", "benchmark", "sizing", "tam", "forecast", "positioning"],
    defaultDeliverableFormat: "markdown",
  },
  feedback_analysis: {
    slug: "feedback_analysis",
    label: "Customer Feedback Analysis",
    workerTitle: "AI Customer Feedback Analyst",
    description: "Categorizes customer feedback and reports themes, sentiment and priorities.",
    keywords: ["feedback", "reviews", "nps", "survey", "complaints", "feature requests", "sentiment", "voice of customer", "churn reasons"],
    defaultDeliverableFormat: "markdown",
  },
  support_triage: {
    slug: "support_triage",
    label: "Support Triage",
    workerTitle: "AI Support Triage Specialist",
    description: "Classifies, prioritizes and routes inbound support tickets.",
    keywords: ["support", "tickets", "triage", "helpdesk", "zendesk", "intercom", "escalate", "routing"],
    defaultDeliverableFormat: "csv",
  },
  finance_ops: {
    slug: "finance_ops",
    label: "Finance Operations",
    workerTitle: "AI Finance Ops Associate",
    description: "Reconciles, categorizes and reports on financial records.",
    keywords: ["invoice", "invoices", "expenses", "reconcile", "reconciliation", "bookkeeping", "spend", "budget", "accounts payable"],
    defaultDeliverableFormat: "csv",
  },
  content: {
    slug: "content",
    label: "Content & Writing",
    workerTitle: "AI Content Specialist",
    description: "Drafts and repurposes written content to a brief.",
    keywords: ["blog", "newsletter", "write", "draft", "copy", "content", "social posts", "linkedin posts", "summarize articles"],
    defaultDeliverableFormat: "markdown",
  },
  general: {
    slug: "general",
    label: "General Operations",
    workerTitle: "AI Operations Associate",
    description: "General multi-step knowledge work.",
    keywords: [],
    defaultDeliverableFormat: "markdown",
  },
};

/** Deterministic keyword-based family detection. Used in simulated mode and as a prompt hint in live mode. */
export function detectJobFamily(text: string): JobFamily {
  const haystack = text.toLowerCase();
  let best: JobFamily = "general";
  let bestScore = 0;
  for (const family of JOB_FAMILIES) {
    const score = JOB_FAMILY_INFO[family].keywords.reduce(
      (acc, kw) => (haystack.includes(kw) ? acc + (kw.includes(" ") ? 2 : 1) : acc),
      0,
    );
    if (score > bestScore) {
      best = family;
      bestScore = score;
    }
  }
  return best;
}
