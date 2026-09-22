import { JobSpecSchema, type JobSpec } from "@/server/domain";

/**
 * The approved JobSpecs behind the three demo workers — written the way the scoper would have produced them from
 * Acme Robotics' intake, so the job pages, briefs and evaluation plans read like a real customer's jobs. Field
 * names are the ones the simulated tools can answer (see simulation/fields.ts), exactly as a live hire would get.
 */

const field = (name: string, description: string, required = false) => ({ name, description, required });

/** Alex — weekly AI infrastructure funding briefing (market_research). */
export const ALEX_SPEC: JobSpec = JobSpecSchema.parse({
  schemaVersion: 1,
  title: "AI Infrastructure Funding Tracker",
  jobFamily: "market_research",
  summary:
    "AI Market Researcher who delivers a weekly AI infra funding report: ranked, sourced funding rounds in AI infrastructure with a short briefing on what changed and why it matters to Acme.",
  objective:
    "Find the AI infrastructure startups that announced funding in the last 30 days and, every Monday, deliver a ranked, sourced briefing on who raised, how much and from whom — and what it says about where compute, inference and data tooling are heading.",
  responsibilities: [
    "Search public sources for AI infrastructure funding announcements from the last 30 days",
    "Capture company, category, stage, amount, investors and source for every round",
    "Rank the rounds by size and summarize the trends that matter to Acme's platform team",
  ],
  inputs: [{ name: "Public web", description: "Funding announcements, trade press and company sites", source: "web", required: true }],
  deliverable: {
    title: "Weekly AI Infra Funding Report",
    description: "Ranked, sourced funding rounds in AI infrastructure with a short briefing on what changed this week.",
    format: "markdown",
    fields: [
      field("company", "Company name", true),
      field("category", "Sub-category of AI infrastructure", true),
      field("stage", "Funding stage (Seed, Series A…)", true),
      field("amount_usd", "Round size in USD", true),
      field("announced_on", "Announcement date (YYYY-MM-DD)"),
      field("lead_investor", "Lead investor"),
      field("hq", "Headquarters city"),
      field("source_url", "Where the round was reported", true),
    ],
    sections: ["Summary", "Top rounds", "Category breakdown"],
    targetCount: 12,
  },
  cadence: { kind: "weekly", hour: 9, dayOfWeek: 1 },
  successCriteria: [
    { id: "coverage", description: "Every relevant AI infrastructure round in the window is captured", metric: "Records per run", target: ">= 12" },
    { id: "sourcing", description: "Every record cites a source URL", metric: "Field completeness", target: "100%" },
    { id: "freshness", description: "Only announcements from the last 30 days", metric: "Acceptance rate", target: ">= 85%" },
  ],
  constraints: [
    "Only announcements from the last 30 days",
    "Amounts in USD",
    "Focus: AI infrastructure — compute, inference, vector databases, training tooling and agent infrastructure; seed to Series C",
  ],
  outOfScope: ["Contacting companies or investors", "Investment recommendations"],
  toolsLikelyNeeded: ["web_search", "fetch_url", "extract_data"],
  approvalPolicy: { requireApprovalFor: [], notes: "Runs need no approvals; the report waits for review in the workspace." },
  budget: { maxCostPerRunUsd: 1 },
  assumptions: ["English-language sources are sufficient", "Public announcements are the source of truth for round details"],
});

export const PRODUCT_TEAM_EMAIL = "product@acme.example";

/** Maya — daily customer feedback report, emailed to the product team after approval (feedback_analysis). */
export const MAYA_SPEC: JobSpec = JobSpecSchema.parse({
  schemaVersion: 1,
  title: "Customer Feedback Digest",
  jobFamily: "feedback_analysis",
  summary:
    "AI Customer Feedback Analyst who reads every piece of customer feedback each morning, labels it by theme, sentiment and severity, and sends the product team a prioritized report.",
  objective:
    "Each morning, read all new customer feedback from support, NPS, app reviews and sales calls, categorize every item by theme, sentiment and severity, and email the product team a report of the top themes with verbatims and the fixes that would remove the most pain.",
  responsibilities: [
    "Read every new feedback item from the connected sources",
    "Label each item with a consistent theme, sentiment and severity",
    "Report the top themes with counts, verbatims and recommended actions",
    "Send the finished report to the product team once it is approved",
  ],
  inputs: [{ name: "Customer feedback", description: "Support tickets, NPS comments, app reviews and sales call notes", source: "provided_data", required: true }],
  deliverable: {
    title: "Customer Feedback Report",
    description: "Every feedback item categorized by theme, sentiment and severity, with the top themes, priorities and recommended actions.",
    format: "markdown",
    fields: [
      field("id", "Feedback item id", true),
      field("customer", "Customer or account", true),
      field("plan", "Customer's plan"),
      field("channel", "Where the feedback came from"),
      field("text", "The feedback itself", true),
      field("category", "Primary theme", true),
      field("sentiment", "positive / neutral / negative", true),
      field("severity", "low / medium / high business impact", true),
    ],
    sections: ["Summary", "Themes by volume", "Notable feedback"],
    targetCount: 24,
  },
  cadence: { kind: "daily", hour: 8 },
  successCriteria: [
    { id: "coverage", description: "Every item in the period is categorized", metric: "Records per run", target: ">= 24" },
    { id: "consistency", description: "The same complaint always gets the same theme", metric: "Acceptance rate", target: ">= 85%" },
    { id: "actionable", description: "Recommendations name the affected area and a next step", metric: "Quality score", target: ">= 80%" },
  ],
  constraints: ["Keep the customer's original wording in the record", "Churn threats are always high severity"],
  outOfScope: ["Replying to customers", "Changing tickets or CRM records"],
  toolsLikelyNeeded: ["read_dataset", "send_notification"],
  approvalPolicy: {
    requireApprovalFor: ["Sending the report to anyone by email or Slack"],
    notes: `Deliver to ${PRODUCT_TEAM_EMAIL} after each run.`,
  },
  budget: { maxCostPerRunUsd: 1 },
  assumptions: ["Feedback arrives through the connected sources without manual export"],
});

/** Sam — daily AI infrastructure market map for the strategy team (market_analysis). */
export const SAM_SPEC: JobSpec = JobSpecSchema.parse({
  schemaVersion: 1,
  title: "AI Infrastructure Market Map",
  jobFamily: "market_analysis",
  summary:
    "AI Market Analyst who keeps a daily map of the AI infrastructure companies Acme competes and partners with: category, stage, funding and positioning, with a short analysis of where the market is moving.",
  objective:
    "Map the AI infrastructure companies building compute, inference, training and agent infrastructure every morning — segment, stage, amount raised and backers — so Acme's strategy team knows which segments are heating up and where its robotics compute platform should partner or compete.",
  responsibilities: [
    "Identify the AI infrastructure companies relevant to Acme's robotics compute platform",
    "Record segment, stage, amount raised, backers and source for each company",
    "Group the landscape by segment and write an analysis with concrete recommendations",
  ],
  inputs: [{ name: "Public web", description: "Company sites, funding announcements and trade press", source: "web", required: true }],
  deliverable: {
    title: "AI Infra Market Map",
    description: "A sourced table of AI infrastructure companies by category with an analysis of where the market is moving and what Acme should do.",
    format: "markdown",
    fields: [
      field("company", "Company name", true),
      field("category", "Segment of AI infrastructure", true),
      field("stage", "Latest funding stage", true),
      field("amount_usd", "Latest round size in USD", true),
      field("lead_investor", "Lead investor of the latest round"),
      field("hq", "Headquarters city"),
      field("source_url", "Source of the record", true),
    ],
    sections: ["Summary", "Companies", "Category breakdown"],
    targetCount: 10,
  },
  cadence: { kind: "daily", hour: 7 },
  successCriteria: [
    { id: "coverage", description: "At least ten relevant AI infrastructure companies per map", metric: "Records per run", target: ">= 10" },
    { id: "completeness", description: "Every company has its category, stage, amount and source", metric: "Field completeness", target: "100%" },
    { id: "actionable", description: "Recommendations are specific and defensible", metric: "Quality score", target: ">= 80%" },
  ],
  constraints: ["Amounts in USD", "One row per company"],
  outOfScope: ["Contacting companies", "Investment advice"],
  toolsLikelyNeeded: ["web_search", "fetch_url", "extract_data"],
  approvalPolicy: { requireApprovalFor: [], notes: "Runs need no approvals; the map waits for review in the workspace." },
  budget: { maxCostPerRunUsd: 1 },
  assumptions: ["Public announcements are enough to place each company"],
});

/** Intake for the job that is scoped and approved but not staffed yet ("ready to hire" on the Jobs page). */
export const PRICING_JOB = {
  description:
    "Weekly competitor pricing check. Every Monday, analyze the pricing pages of our five closest competitors and tell me what changed — new plans, price moves, free-tier changes — with a clear recommendation for our own pricing.",
  answers: {
    competitors: "Vectorloom, Latchkey AI, Kestrelflow, Tokenforge and Gatehouse AI",
    dimensions: "Pricing and packaging",
    recipients: "Just me, in the workspace",
  } as Record<string, string>,
};

/** Intake for the job that was just opened: follow-up questions are waiting for answers. */
export const TRIAGE_JOB_DESCRIPTION =
  "Overnight support ticket triage. Every morning, classify the tickets that came in overnight, set a priority and route each one to the right team so the morning shift starts on the urgent ones first.";
