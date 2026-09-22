import type { SimCompany } from "@/server/simulation/types";
import type { Sector } from "../constraints";
import { isoDaysAgo } from "../dates";

/**
 * 48 CLEARLY FICTIONAL AI-infrastructure companies (names, funds and people are invented; every URL uses the
 * reserved `.example` TLD). `daysAgo` is resolved against the clock at call time so rounds always look recent.
 * This is the default universe; a second, smaller one (fintech.ts) exists for briefs that target fintech.
 */

export type AiInfraGroup = "compute" | "serving" | "data" | "trust_agents";
export type FintechGroup = "payments" | "lending_banking" | "risk_compliance";
export type CategoryGroup = AiInfraGroup | FintechGroup;

export const CATEGORY_GROUPS: Record<CategoryGroup, { label: string; categories: readonly string[] }> = {
  compute: { label: "Compute, training and edge", categories: ["GPU Cloud", "Training Orchestration", "Edge AI"] },
  serving: { label: "Model serving, routing and fine-tuning", categories: ["Inference Platform", "Model Gateway", "Fine-Tuning"] },
  data: { label: "AI data infrastructure", categories: ["Vector Database", "Data Labeling", "Synthetic Data"] },
  trust_agents: {
    label: "Agents, evaluation and AI security",
    categories: ["Evaluation & Observability", "Agent Infrastructure", "AI Security & Governance"],
  },
  payments: { label: "Fintech: payments, embedded finance and treasury", categories: ["Payments Infrastructure", "Embedded Finance", "Treasury & FX"] },
  lending_banking: { label: "Fintech: lending, banking and wealth", categories: ["Lending", "Banking-as-a-Service", "WealthTech"] },
  risk_compliance: { label: "Fintech: compliance, fraud and insurance", categories: ["RegTech & Compliance", "Fraud Prevention", "InsurTech"] },
};

export const SECTOR_OF_GROUP: Record<CategoryGroup, Sector> = {
  compute: "ai_infrastructure",
  serving: "ai_infrastructure",
  data: "ai_infrastructure",
  trust_agents: "ai_infrastructure",
  payments: "fintech",
  lending_banking: "fintech",
  risk_compliance: "fintech",
};

export interface CompanyFixture {
  company: string;
  slug: string;
  category: string;
  description: string;
  stage: "Seed" | "Series A" | "Series B" | "Series C";
  amount_usd: number;
  daysAgo: number;
  lead_investor: string;
  hq: string;
  employees: number;
}

/** A company with its dates resolved + routing metadata used by search/pages. */
export interface CompanyEntity extends SimCompany {
  slug: string;
  group: CategoryGroup;
  sector: Sector;
  daysAgo: number;
}

export type Row = [
  company: string,
  slug: string,
  stage: CompanyFixture["stage"],
  amountMillions: number,
  daysAgo: number,
  leadInvestor: string,
  hq: string,
  employees: number,
  description: string,
];

const BY_CATEGORY: Record<string, Row[]> = {
  "GPU Cloud": [
    ["Halcyon Compute", "halcyoncompute", "Series B", 85, 6, "Meridian Peak Ventures", "Austin, TX", 140, "On-demand H100 and B200 clusters with per-second billing and a reserved-capacity marketplace for AI labs."],
    ["Ridgeline GPU", "ridgelinegpu", "Series C", 210, 19, "Atlas North Capital", "Denver, CO", 320, "Renewable-powered GPU data centers offering bare-metal training clusters with InfiniBand networking."],
    ["Cinderblock Cloud", "cinderblockcloud", "Series A", 28, 33, "Copperline Capital", "Toronto, Canada", 58, "Spot-priced GPU capacity aggregated from underused enterprise data centers, with automatic checkpoint migration."],
    ["Borealis Compute", "borealiscompute", "Series B", 64, 47, "Harborlight Ventures", "Stockholm, Sweden", 115, "Sovereign GPU cloud for European AI teams with in-region data residency and liquid-cooled clusters."],
    ["Stratacore", "stratacore", "Seed", 7.5, 12, "Quorum Seed Fund", "Seattle, WA", 19, "Serverless GPU functions that cold-start large models in under two seconds."],
  ],
  "Training Orchestration": [
    ["Clusterwick", "clusterwick", "Series A", 22, 27, "Signal Ridge Capital", "San Francisco, CA", 44, "Kubernetes-native scheduler that packs multi-node training jobs to push GPU utilization above 90%."],
    ["Checkpointly", "checkpointly", "Seed", 5, 40, "Paper Crane Capital", "Zurich, Switzerland", 14, "Fault-tolerant checkpointing and automatic job recovery for long-running distributed training."],
    ["Shardline", "shardline", "Series A", 31, 9, "Blue Heron Partners", "Pittsburgh, PA", 52, "Distributed training framework that automates tensor, pipeline and data parallelism across mixed GPU fleets."],
  ],
  "Edge AI": [
    ["Edgekiln", "edgekiln", "Series A", 18, 15, "Tidewater Ventures", "Munich, Germany", 47, "Compiler toolchain that shrinks transformer models to run on microcontrollers and industrial gateways."],
    ["Pocketmodel", "pocketmodel", "Seed", 6.2, 52, "Ninth Street Ventures", "New York, NY", 21, "SDK for running quantized language models fully on-device across iOS and Android."],
    ["Tinygrid", "tinygrid", "Series A", 15, 36, "Evergreen Row Ventures", "Bengaluru, India", 63, "Fleet management and over-the-air model updates for computer-vision devices at the edge."],
    ["Perimeter ML", "perimeterml", "Series B", 42, 23, "Lantern Growth", "Boston, MA", 96, "On-prem inference appliances for factories and hospitals that cannot send data to the cloud."],
  ],
  "Inference Platform": [
    ["Latchkey AI", "latchkeyai", "Series B", 72, 3, "Foundry Lane Capital", "San Francisco, CA", 120, "Managed inference endpoints for open-weight models with autoscaling and token-level billing."],
    ["Kestrelflow", "kestrelflow", "Series A", 34, 17, "Meridian Peak Ventures", "London, UK", 61, "Low-latency inference engine with speculative decoding and continuous batching for real-time voice and chat."],
    ["Tokenforge", "tokenforge", "Series A", 26, 30, "Signal Ridge Capital", "Seattle, WA", 49, "Inference optimization layer that cuts LLM serving costs with automated quantization and kernel tuning."],
    ["Swiftlayer", "swiftlayer", "Seed", 8, 44, "Quorum Seed Fund", "Amsterdam, Netherlands", 23, "Multi-cloud model serving with built-in failover across GPU providers."],
    ["Parallax Serve", "parallaxserve", "Series C", 150, 55, "Atlas North Capital", "New York, NY", 260, "Dedicated inference clusters for enterprises that need private deployments of frontier open models."],
  ],
  "Model Gateway": [
    ["Routewise AI", "routewiseai", "Seed", 6.8, 8, "Paper Crane Capital", "Austin, TX", 17, "LLM gateway that routes each request to the cheapest model that still meets a quality bar."],
    ["Gatehouse AI", "gatehouseai", "Series A", 24, 25, "Brightwater Partners", "Tel Aviv, Israel", 55, "Enterprise AI gateway with unified API keys, rate limits, spend controls and audit logs across model providers."],
    ["Switchyard Labs", "switchyardlabs", "Seed", 4.5, 49, "Ninth Street Ventures", "Berlin, Germany", 12, "Open-source model router with semantic caching and automatic fallback between providers."],
  ],
  "Fine-Tuning": [
    ["Tunewright", "tunewright", "Series A", 20, 11, "Blue Heron Partners", "San Francisco, CA", 41, "Fine-tuning platform that turns production logs into task-specific small models."],
    ["Adapterly", "adapterly", "Seed", 5.5, 38, "Tidewater Ventures", "Toronto, Canada", 16, "Hosted LoRA adapter training and serving that lets teams run hundreds of fine-tunes on a single base model."],
    ["Distilla", "distilla", "Series A", 29, 21, "Foundry Lane Capital", "Paris, France", 46, "Model distillation service that compresses frontier-model behaviour into models that run ten times cheaper."],
    ["Finchtune", "finchtune", "Seed", 7, 57, "Evergreen Row Ventures", "Boston, MA", 18, "Reinforcement fine-tuning toolkit with built-in reward modelling for domain-specific agents."],
  ],
  "Vector Database": [
    ["Vectorloom", "vectorloom", "Series B", 58, 5, "Foundry Lane Capital", "San Francisco, CA", 105, "Serverless vector database with hybrid search and sub-50ms recall at billion-vector scale."],
    ["Embedwell", "embedwell", "Seed", 6, 29, "Quorum Seed Fund", "London, UK", 20, "Managed embedding pipelines that keep vector indexes in sync with source systems in real time."],
    ["Nearside DB", "nearsidedb", "Series A", 19, 42, "Copperline Capital", "New York, NY", 38, "Postgres-compatible vector store built for multi-tenant SaaS workloads."],
    ["Cosinebase", "cosinebase", "Series A", 25, 14, "Harborlight Ventures", "Singapore", 57, "GPU-accelerated vector search engine for recommendation and retrieval workloads."],
  ],
  "Data Labeling": [
    ["Labelhive", "labelhive", "Series B", 48, 20, "Lantern Growth", "San Francisco, CA", 130, "Expert-in-the-loop labeling marketplace for RLHF and domain-specific evaluation data."],
    ["Annotara", "annotara", "Series A", 16, 35, "Brightwater Partners", "Boston, MA", 64, "Model-assisted annotation for medical imaging and clinical text with built-in compliance workflows."],
    ["Goldenset", "goldenset", "Seed", 4.8, 46, "Paper Crane Capital", "Dublin, Ireland", 13, "Tooling for building and versioning the golden datasets used to regression-test LLM applications."],
    ["Tagfoundry", "tagfoundry", "Series A", 21, 53, "Evergreen Row Ventures", "Bengaluru, India", 210, "Multilingual data labeling workforce with automated quality audits for speech and document AI."],
  ],
  "Synthetic Data": [
    ["Synthvale", "synthvale", "Series A", 17, 10, "Tidewater Ventures", "Zurich, Switzerland", 35, "Privacy-preserving synthetic tabular data for training models in regulated industries."],
    ["Corpusworks", "corpusworks", "Series B", 55, 31, "Meridian Peak Ventures", "New York, NY", 88, "Licensed and synthetic text corpora curated for pre-training and domain adaptation."],
    ["Datamason", "datamason", "Seed", 5.2, 24, "Ninth Street Ventures", "Seattle, WA", 15, "Data-quality pipelines that deduplicate, filter and score training data before it reaches the GPU."],
  ],
  "Evaluation & Observability": [
    ["Evalight", "evalight", "Series A", 23, 4, "Signal Ridge Capital", "San Francisco, CA", 43, "Continuous evaluation platform that scores LLM outputs against custom rubrics in CI and production."],
    ["Tracewright", "tracewright", "Seed", 6.5, 18, "Quorum Seed Fund", "Berlin, Germany", 19, "OpenTelemetry-native tracing for multi-step LLM and agent workflows."],
    ["Promptmeter", "promptmeter", "Seed", 4.2, 37, "Paper Crane Capital", "Austin, TX", 11, "Cost and latency analytics for LLM features, broken down by customer, prompt and model."],
    ["Gradewell", "gradewell", "Series A", 18.5, 28, "Blue Heron Partners", "London, UK", 40, "Human-plus-model grading workflows for benchmarking AI assistants before launch."],
    ["Lumen Trace", "lumentrace", "Series B", 45, 50, "Lantern Growth", "New York, NY", 92, "Production monitoring that detects hallucinations, drift and prompt regressions in real time."],
  ],
  "Agent Infrastructure": [
    ["Agentdock", "agentdock", "Series A", 30, 2, "Foundry Lane Capital", "San Francisco, CA", 50, "Runtime for deploying long-running AI agents with durable state, retries and human approvals."],
    ["Relaywork", "relaywork", "Seed", 7.2, 16, "Ninth Street Ventures", "Toronto, Canada", 22, "Workflow orchestration layer that lets AI agents hand off tasks to each other and to humans."],
    ["Toolbridge", "toolbridge", "Series A", 27, 32, "Brightwater Partners", "Tel Aviv, Israel", 58, "Managed connectors and permissioning that let AI agents safely use enterprise SaaS tools."],
    ["Loopwarden", "loopwarden", "Seed", 8.5, 41, "Copperline Capital", "Seattle, WA", 24, "Sandboxed execution environments and guardrails for autonomous coding agents."],
    ["Handoff Labs", "handofflabs", "Series A", 21.5, 54, "Harborlight Ventures", "Paris, France", 37, "Browser automation infrastructure purpose-built for AI agents, with session replay and managed browser fleets."],
  ],
  "AI Security & Governance": [
    ["Sentrymesh", "sentrymesh", "Series A", 32, 7, "Atlas North Capital", "Tel Aviv, Israel", 66, "Runtime firewall that blocks prompt injection and data exfiltration in LLM applications."],
    ["Redactly", "redactly", "Seed", 5.8, 26, "Evergreen Row Ventures", "Amsterdam, Netherlands", 18, "PII detection and redaction proxy that sits between enterprise data and model providers."],
    ["Policyloom", "policyloom", "Series B", 52, 45, "Meridian Peak Ventures", "Washington, DC", 102, "AI governance platform that maps model usage to regulatory controls and produces audit-ready evidence."],
  ],
};

export function fixturesFrom(byCategory: Record<string, Row[]>): CompanyFixture[] {
  return Object.entries(byCategory).flatMap(([category, rows]) =>
    rows.map(([company, slug, stage, amountMillions, daysAgo, lead_investor, hq, employees, description]) => ({
      company,
      slug,
      category,
      description,
      stage,
      amount_usd: Math.round(amountMillions * 1_000_000),
      daysAgo,
      lead_investor,
      hq,
      employees,
    })),
  );
}

export const COMPANY_FIXTURES: readonly CompanyFixture[] = fixturesFrom(BY_CATEGORY);

export function groupOfCategory(category: string): CategoryGroup {
  const hit = (Object.keys(CATEGORY_GROUPS) as CategoryGroup[]).find((g) => CATEGORY_GROUPS[g].categories.includes(category));
  return hit ?? "trust_agents";
}

/** Most recent round first. */
export function companyEntities(now: Date): CompanyEntity[] {
  return entitiesFrom(COMPANY_FIXTURES, now);
}

export function entitiesFrom(fixtures: readonly CompanyFixture[], now: Date): CompanyEntity[] {
  return fixtures.map((f) => ({
    company: f.company,
    website: `https://${f.slug}.example`,
    category: f.category,
    description: f.description,
    stage: f.stage,
    amount_usd: f.amount_usd,
    announced_on: isoDaysAgo(f.daysAgo, now),
    lead_investor: f.lead_investor,
    hq: f.hq,
    employees: f.employees,
    source_url: `https://news.example/funding/${f.slug}`,
    slug: f.slug,
    group: groupOfCategory(f.category),
    sector: SECTOR_OF_GROUP[groupOfCategory(f.category)],
    daysAgo: f.daysAgo,
  })).sort((a, b) => a.daysAgo - b.daysAgo);
}

/** Strip routing metadata → the frozen public shape. */
export function toSimCompany(e: CompanyEntity): SimCompany {
  return {
    company: e.company,
    website: e.website,
    category: e.category,
    description: e.description,
    stage: e.stage,
    amount_usd: e.amount_usd,
    announced_on: e.announced_on,
    lead_investor: e.lead_investor,
    hq: e.hq,
    employees: e.employees,
    source_url: e.source_url,
  };
}
