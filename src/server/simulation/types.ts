import type { AgentComponent } from "@/server/domain/blueprint";
import type { JobFamily } from "@/server/domain/job-family";
import type { JobSpec } from "@/server/domain/job-spec";
import type { ChatMessage, MockTextResponse, ToolSpec } from "@/server/models/types";

/**
 * Simulation layer contract — everything that makes "Simulated mode" feel real while staying
 * 100% deterministic (same inputs → same outputs; no Math.random, no Date.now in generated content
 * except where a date is explicitly passed in).
 *
 * Consumers:
 *   - tools/* use the fixture functions as mock fallbacks (web_search, fetch_url, extract_data …)
 *   - runtime's agent loop uses `agentTurn` as the `mock` producer for llm.generateText
 *   - prisma/seed.ts uses the datasets to build realistic history
 */

export interface SimSearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  publishedAt: string; // ISO date
}

export interface SimPage {
  url: string;
  title: string;
  /** Plain text body. For URLs produced by `search`, contains the facts that `extractRecords` can pull out. */
  text: string;
}

export interface SimCompany {
  company: string;
  website: string;
  category: string;
  description: string;
  stage: string;
  amount_usd: number;
  announced_on: string; // ISO date
  lead_investor: string;
  hq: string;
  employees: number;
  source_url: string;
}

export interface SimFeedbackItem {
  id: string;
  customer: string;
  plan: "free" | "pro" | "enterprise";
  channel: "support" | "nps" | "app_review" | "sales_call";
  text: string;
  received_on: string; // ISO date
  /** Ground truth used by simulated categorization. */
  category: string;
  sentiment: "positive" | "neutral" | "negative";
  severity: "low" | "medium" | "high";
}

export interface MockAgentTurnInput {
  component: AgentComponent;
  jobFamily: JobFamily;
  /** Structured spec — read deliverable.fields / targetCount from here; never parse jobBrief. */
  spec: JobSpec;
  /** The seeded `job_brief` context value (kept for prompt parity with live mode). */
  jobBrief: string;
  /** One-off instructions for this run. */
  instructions: string[];
  system?: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
}

/** Public surface of src/server/simulation/index.ts (exported as `simulation`). */
export interface Simulation {
  search(query: string, opts?: { maxResults?: number }): SimSearchResult[];
  fetchPage(url: string): SimPage;
  /** Pull structured records out of (simulated) page text / search snippets. Unknown text → best-effort generic records. */
  extractRecords(text: string, fields: string[], opts?: { maxRecords?: number }): Array<Record<string, unknown>>;
  companies(): SimCompany[];
  feedback(): SimFeedbackItem[];
  /** Records for tools.read_dataset (SAMPLE_DATASETS in tools/schemas.ts). Unknown name → []. */
  dataset(name: string): Array<Record<string, unknown>>;
  /**
   * The mock "brain": given the conversation so far, decide the next assistant turn — either tool calls
   * (only tools present in `tools`) or a final answer in the component's outputFormat.
   * Output quality deliberately depends on the blueprint (tier, instructions, tools) so that the
   * Replace flow produces measurably better workers even in Simulated mode.
   */
  agentTurn(input: MockAgentTurnInput): MockTextResponse;
}
