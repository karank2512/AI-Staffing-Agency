import type { DeliverableFormat, DeliverableStatus, RunStatus } from "@prisma/client";
import { db, toJson } from "@/server/db";
import type { EvalSubject } from "@/server/evaluation/types";
import type { createHiredWorker } from "../helpers/fixtures";

/** Rows written directly with `db` so the evaluation suites never depend on the runtime module. */

export type Hired = Awaited<ReturnType<typeof createHiredWorker>>;

export interface CreateRunOptions {
  status?: RunStatus;
  costUsd?: number;
  durationMs?: number | null;
  /** Defaults to `finishedAt`, else now. */
  createdAt?: Date;
  finishedAt?: Date | null;
  error?: string;
  workerVersionId?: string;
}

export async function createRun(hired: Hired, opts: CreateRunOptions = {}) {
  const status = opts.status ?? "SUCCEEDED";
  const terminal = status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED";
  const finishedAt = opts.finishedAt === undefined ? (terminal ? new Date() : null) : opts.finishedAt;
  const createdAt = opts.createdAt ?? finishedAt ?? new Date();
  return db.run.create({
    data: {
      organizationId: hired.worker.organizationId,
      jobId: hired.job.id,
      workerId: hired.worker.id,
      workerVersionId: opts.workerVersionId ?? hired.version.id,
      status,
      trigger: "MANUAL",
      simulated: true,
      costUsd: opts.costUsd ?? 0.12,
      durationMs: opts.durationMs === undefined ? 45_000 : opts.durationMs,
      error: opts.error,
      createdAt,
      startedAt: createdAt,
      finishedAt,
    },
  });
}

export interface CreateDeliverableOptions {
  title?: string;
  content?: string;
  data?: unknown;
  format?: DeliverableFormat;
  status?: DeliverableStatus;
  feedback?: string;
  createdAt?: Date;
}

export async function createDeliverable(hired: Hired, runId: string, opts: CreateDeliverableOptions = {}) {
  const run = await db.run.findUniqueOrThrow({ where: { id: runId }, select: { workerVersionId: true, createdAt: true } });
  return db.deliverable.create({
    data: {
      organizationId: hired.worker.organizationId,
      jobId: hired.job.id,
      workerId: hired.worker.id,
      workerVersionId: run.workerVersionId,
      runId,
      title: opts.title ?? "Weekly AI Infra Funding Report — test",
      content: opts.content ?? goodReport(goodRecords()),
      format: opts.format ?? "MARKDOWN",
      status: opts.status ?? "PENDING_REVIEW",
      feedback: opts.feedback,
      createdAt: opts.createdAt ?? run.createdAt,
      ...(opts.data === undefined ? {} : { data: toJson(opts.data) }),
    },
  });
}

/** A finished run with a deliverable in one call. */
export async function createRunWithDeliverable(hired: Hired, run: CreateRunOptions = {}, deliverable: CreateDeliverableOptions = {}) {
  const created = await createRun(hired, run);
  const del = await createDeliverable(hired, created.id, deliverable);
  return { run: created, deliverable: del };
}

// ── Deliverable content ─────────────────────────────────────────────────────

const COMPANIES = [
  ["Vectorline Systems", "Series B", 48_000_000, "Ridgecrest Ventures", "vector databases"],
  ["Lattice Compute", "Series A", 22_000_000, "Northgate Capital", "GPU orchestration"],
  ["Kestrel Inference", "Seed", 6_500_000, "Harbor Seed", "inference serving"],
  ["Quillon Data", "Series C", 95_000_000, "Meridian Growth", "data pipelines"],
  ["Orbital Weights", "Series A", 18_000_000, "Summit Partners Labs", "model registries"],
  ["Tessera Labs", "Seed", 4_000_000, "Foundry Angels", "evaluation tooling"],
  ["Pinecrest AI", "Series B", 60_000_000, "Ridgecrest Ventures", "vector databases"],
  ["Halyard Networks", "Series A", 27_000_000, "Bluewater Capital", "AI networking"],
  ["Cairn Observability", "Seed", 5_200_000, "Harbor Seed", "LLM observability"],
  ["Marrow Chips", "Series D", 140_000_000, "Meridian Growth", "AI accelerators"],
] as const;

/** A type alias (not an interface) so it is assignable to EvalSubject["records"]. */
export type FundingRecord = {
  company: string;
  stage: string;
  amount_usd: number | null;
  lead_investor: string;
  category: string;
  source_url: string | null;
};

export function goodRecords(count: number = COMPANIES.length): FundingRecord[] {
  return COMPANIES.slice(0, count).map(([company, stage, amount_usd, lead_investor, category]) => ({
    company,
    stage,
    amount_usd,
    lead_investor,
    category,
    source_url: `https://news.example/${company.toLowerCase().replace(/\s+/g, "-")}`,
  }));
}

/** What a fast-tier collector without validate/dedupe produces: short, gappy and repetitive. */
export function poorRecords(): FundingRecord[] {
  const [a, b, c, d, e, f] = goodRecords(6);
  return [
    a,
    { ...b, amount_usd: null },
    { ...c, source_url: "" },
    { ...d, amount_usd: null, source_url: "n/a" },
    { ...a, stage: "series b" }, // duplicate of the first row
    { ...e, source_url: null },
    f,
  ];
}

function table(records: FundingRecord[]): string {
  const rows = records.map((r, i) => `| ${i + 1} | ${r.company} | ${r.stage} | ${r.amount_usd ?? ""} | ${r.lead_investor} |`);
  return ["| rank | company | stage | amount_usd | lead_investor |", "| --- | --- | --- | --- | --- |", ...rows].join("\n");
}

export function goodReport(records: FundingRecord[] = goodRecords()): string {
  const total = records.reduce((s, r) => s + (r.amount_usd ?? 0), 0);
  const [top, second, third] = records;
  return [
    "# Weekly AI Infra Funding Report",
    "",
    "## Summary",
    "",
    `This week ${records.length} AI infrastructure startups announced new rounds totalling $${(total / 1e6).toFixed(0)}M. ` +
      `The largest was ${top.company}'s ${top.stage} of $${((top.amount_usd ?? 0) / 1e6).toFixed(0)}M led by ${top.lead_investor}, ` +
      `followed by ${second.company} ($${((second.amount_usd ?? 0) / 1e6).toFixed(0)}M) and ${third.company} ($${((third.amount_usd ?? 0) / 1e6).toFixed(1)}M).`,
    "",
    "Three trends stand out. First, vector database vendors keep attracting late-stage capital: two of the ten rounds went to that category, " +
      "and Ridgecrest Ventures led both. Second, seed activity is concentrated in tooling around the model lifecycle — evaluation, observability " +
      "and registries — with round sizes between $4M and $7M. Third, hardware is back: a single Series D accounted for roughly a third of the week's total.",
    "",
    "Stage mix: 3 seed rounds, 3 Series A, 2 Series B, 1 Series C and 1 Series D. Median round size was $24.5M. " +
      "The most active investors were Ridgecrest Ventures and Meridian Growth with two rounds each, and Harbor Seed backed two of the three seed deals.",
    "",
    "## Top rounds",
    "",
    table(records),
    "",
    "## Trends",
    "",
    "- Late-stage money is flowing to infrastructure with proven revenue (databases, accelerators).",
    "- Seed investors favour picks-and-shovels for LLM operations.",
    "- Expect follow-on rounds for the Series A cohort within 12 months.",
  ].join("\n");
}

export function poorReport(records: FundingRecord[] = poorRecords()): string {
  return ["# Funding update", "", "Some AI startups raised money recently. Investors seem interested in the space.", "", "## Top rounds", "", table(records)].join("\n");
}

export function subject(overrides: Partial<EvalSubject> = {}): EvalSubject {
  return {
    content: goodReport(),
    format: "markdown",
    records: goodRecords(),
    costUsd: 0.2,
    durationSec: 40,
    ...overrides,
  };
}
