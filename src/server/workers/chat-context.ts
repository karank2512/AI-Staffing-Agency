import type { DeliverableStatus, MessageRole, RunStatus, RunTrigger, WorkerHealth, WorkerStatus } from "@prisma/client";
import { format } from "date-fns";
import { db } from "@/server/db";
import { describeCadence, renderJobBrief, workerFieldsToCadence, type Cadence, type JobSpec, type ReviewMetrics, type WorkerBlueprint, type WorkerScore } from "@/server/domain";
import { computeWorkerScore, getWorkerMetrics, runScore } from "@/server/evaluation";
import { conflict } from "@/server/errors";
import { clip, formatKpiValue, lowerFirst, parseStoredBlueprint, parseStoredSpec, type WorkerRecord } from "./shared";

/**
 * Everything a worker knows about itself when it answers a message: the job, its design, its last few runs,
 * its numbers and its schedule. Built once per message and handed to both the live prompt and the mock reply,
 * so the two answer from the same facts.
 */

export const RECENT_RUNS = 5;
const RECENT_MESSAGES = 8;

export interface RecentRun {
  id: string;
  status: RunStatus;
  trigger: RunTrigger;
  createdAt: Date;
  finishedAt: Date | null;
  error: string | null;
  costUsd: number;
  deliverable: { id: string; title: string; status: DeliverableStatus } | null;
  /** 0..100, null while unevaluated or not finished. */
  score: number | null;
}

/** What the most recent successful run actually did — the evidence behind "why these sources?". */
export interface RunMethod {
  runId: string;
  at: Date;
  /** web_search queries, in call order. */
  searches: string[];
  pagesRead: number;
  /** Distinct hosts of the pages read, in order of first read. */
  hosts: string[];
  datasets: string[];
  extractions: number;
  /** Records in / out of the cleaning steps (validate_records → dedupe), when the design has them. */
  collected: number | null;
  kept: number | null;
  /** Cleaning steps that ran ("validate_records", "dedupe"). */
  checks: string[];
  delivered: number | null;
}

export interface WorkerChatContext {
  worker: {
    id: string;
    name: string;
    title: string;
    status: WorkerStatus;
    health: WorkerHealth;
    healthReason: string | null;
    nextRunAt: Date | null;
    lastRunAt: Date | null;
  };
  jobTitle: string;
  spec: JobSpec;
  blueprint: WorkerBlueprint;
  versionNumber: number;
  cadence: Cadence;
  /** Newest first. */
  recentRuns: RecentRun[];
  metrics: ReviewMetrics;
  score: WorkerScore;
  /** One-off instructions still waiting for the next run. */
  activeInstructions: string[];
  pendingProposal: { id: string; version: number } | null;
  lastRunMethod: RunMethod | null;
  /** Chronological, for conversational continuity in the live prompt. */
  recentMessages: Array<{ role: MessageRole; content: string }>;
}

export async function buildChatContext(organizationId: string, worker: WorkerRecord): Promise<WorkerChatContext> {
  const version = worker.currentVersion;
  if (!version) throw conflict(`${worker.name} has no active version to talk to`);
  const blueprint = parseStoredBlueprint(version.blueprint);
  const spec = parseStoredSpec(version.jobSpec.spec);

  const [runs, metrics, score, instructions, proposal, messages] = await Promise.all([
    db.run.findMany({
      where: { organizationId, workerId: worker.id },
      orderBy: { createdAt: "desc" },
      take: RECENT_RUNS,
      select: {
        id: true,
        status: true,
        trigger: true,
        createdAt: true,
        finishedAt: true,
        error: true,
        costUsd: true,
        deliverables: { orderBy: { createdAt: "asc" }, take: 1, select: { id: true, title: true, status: true } },
        evaluations: { select: { type: true, score: true } },
      },
    }),
    getWorkerMetrics(organizationId, worker.id),
    computeWorkerScore(worker.id),
    db.workerMessage.findMany({
      where: { organizationId, workerId: worker.id, classification: "TEMPORARY_INSTRUCTION", instructionActive: true },
      orderBy: { createdAt: "asc" },
      select: { content: true, metadata: true },
    }),
    db.workerVersion.findFirst({ where: { workerId: worker.id, status: "PROPOSED" }, select: { id: true, version: true } }),
    db.workerMessage.findMany({
      where: { organizationId, workerId: worker.id, role: { in: ["USER", "WORKER"] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: RECENT_MESSAGES,
      select: { role: true, content: true },
    }),
  ]);

  const lastSucceeded = runs.find((r) => r.status === "SUCCEEDED");
  const lastRunMethod = lastSucceeded ? await loadRunMethod(lastSucceeded.id, lastSucceeded.finishedAt ?? lastSucceeded.createdAt) : null;

  return {
    worker: {
      id: worker.id,
      name: worker.name,
      title: worker.title,
      status: worker.status,
      health: worker.health,
      healthReason: worker.healthReason,
      nextRunAt: worker.nextRunAt,
      lastRunAt: worker.lastRunAt,
    },
    jobTitle: worker.job.title,
    spec,
    blueprint,
    versionNumber: version.version,
    cadence: workerFieldsToCadence(worker),
    recentRuns: runs.map((r) => ({
      id: r.id,
      status: r.status,
      trigger: r.trigger,
      createdAt: r.createdAt,
      finishedAt: r.finishedAt,
      error: r.error,
      costUsd: Number(r.costUsd),
      deliverable: r.deliverables[0] ?? null,
      score: runScore(r.status, r.evaluations, blueprint.evaluation.weights),
    })),
    metrics,
    score,
    activeInstructions: instructions.map((m) => {
      const normalized = (m.metadata as { normalizedInstruction?: unknown } | null)?.normalizedInstruction;
      return typeof normalized === "string" && normalized.trim().length > 0 ? normalized : m.content;
    }),
    pendingProposal: proposal,
    lastRunMethod,
    recentMessages: messages.reverse(),
  };
}

const record = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const numberOf = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function hostOf(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** The run id comes from an org-scoped run query above, so its steps and tool calls are the caller's. */
async function loadRunMethod(runId: string, at: Date): Promise<RunMethod> {
  const [calls, steps] = await Promise.all([
    db.toolCall.findMany({ where: { runId, status: "SUCCEEDED" }, orderBy: { createdAt: "asc" }, select: { toolName: true, input: true } }),
    db.runStep.findMany({
      where: { runId, kind: { in: ["DETERMINISTIC", "DELIVERABLE"] } },
      orderBy: { index: "asc" },
      select: { componentId: true, kind: true, output: true },
    }),
  ]);
  const searches: string[] = [];
  const hosts: string[] = [];
  const datasets: string[] = [];
  let pagesRead = 0;
  let extractions = 0;
  for (const call of calls) {
    const input = record(call.input);
    if (call.toolName === "web_search" && typeof input?.query === "string") searches.push(input.query);
    if (call.toolName === "fetch_url") {
      pagesRead += 1;
      const host = hostOf(input?.url);
      if (host && !hosts.includes(host)) hosts.push(host);
    }
    if (call.toolName === "read_dataset" && typeof input?.dataset === "string" && !datasets.includes(input.dataset)) datasets.push(input.dataset);
    if (call.toolName === "extract_data") extractions += 1;
  }
  const cleaning = steps.filter((s) => s.kind === "DETERMINISTIC" && (s.componentId === "validate_records" || s.componentId === "dedupe"));
  const first = record(cleaning[0]?.output);
  const last = record(cleaning[cleaning.length - 1]?.output);
  const delivered = numberOf(record(steps.find((s) => s.kind === "DELIVERABLE")?.output)?.records);
  return {
    runId,
    at,
    searches,
    pagesRead,
    hosts,
    datasets,
    extractions,
    collected: numberOf(first?.before),
    kept: numberOf(last?.after),
    checks: cleaning.map((s) => s.componentId ?? "").filter((id) => id.length > 0),
    delivered,
  };
}

// ── Rendering helpers shared by the live prompt and the mock reply ──────────

export const shortDate = (d: Date) => format(d, "MMM d");
export const dateTime = (d: Date) => format(d, "EEEE, MMM d 'at' h:mmaaa");
export const money = (n: number) => `$${n.toFixed(n > 0 && n < 0.01 ? 4 : 2)}`;

export function runLine(run: RecentRun): string {
  const when = shortDate(run.finishedAt ?? run.createdAt);
  const status = run.status.toLowerCase().replace(/_/g, " ");
  const parts = [`${when} · ${status}`];
  if (run.deliverable) parts.push(`“${run.deliverable.title}”${run.deliverable.status === "PENDING_REVIEW" ? "" : ` (${run.deliverable.status.toLowerCase()})`}`);
  if (run.score !== null) parts.push(`score ${Math.round(run.score)}/100`);
  if (run.error) parts.push(`error: ${clip(run.error, 100)}`);
  parts.push(money(run.costUsd));
  return parts.join(" · ");
}

export function scheduleSentence(ctx: WorkerChatContext): string {
  if (ctx.worker.status === "PAUSED") return "I'm paused right now, so nothing is scheduled until I'm resumed.";
  if (ctx.worker.status === "RETIRED") return "I've been retired, so I no longer run.";
  if (ctx.cadence.kind === "manual") return "I run on demand — start a run whenever you need one.";
  const cadence = describeCadence(ctx.cadence);
  const next = ctx.worker.nextRunAt ? `; my next run is ${dateTime(ctx.worker.nextRunAt)}` : "";
  return `I'm scheduled ${lowerFirst(cadence)}${next}.`;
}

/** The fact sheet the live model answers from. Plain text, no markdown headings (the reply must not use them either). */
export function renderContextForPrompt(ctx: WorkerChatContext): string {
  const m = ctx.metrics;
  const lines: string[] = [];
  lines.push(`Worker: ${ctx.worker.name}, ${ctx.worker.title} (version ${ctx.versionNumber}, ${ctx.worker.status.toLowerCase()}, health ${ctx.worker.health.toLowerCase()}${ctx.worker.healthReason ? `: ${ctx.worker.healthReason}` : ""})`);
  lines.push(`Schedule: ${scheduleSentence(ctx)}`);
  lines.push("", clip(renderJobBrief(ctx.spec), 2_500), "");
  lines.push(`Pipeline: ${ctx.blueprint.components.map((c) => (c.type === "agent" ? `${c.name} (${c.modelTier} model, tools: ${c.tools.join(", ") || "none"})` : c.name)).join(" → ")}`);
  lines.push(`Tools: ${ctx.blueprint.tools.map((t) => `${t.toolName}${t.requiresApproval ? " (needs approval)" : ""}`).join(", ") || "none"}`);
  lines.push(`Estimated cost: ${money(ctx.blueprint.costEstimate.perRunUsd)} per run`);
  lines.push("", `Recent runs (newest first):`);
  if (ctx.recentRuns.length === 0) lines.push("- none yet");
  for (const run of ctx.recentRuns) lines.push(`- ${runLine(run)}`);
  lines.push("", `Last ${m.windowDays} days: ${m.runs} finished runs (${m.succeeded} succeeded, ${m.failed} failed), ${m.deliverables} deliverables (${m.accepted} accepted, ${m.rejected} sent back), total cost ${money(m.totalCostUsd)}${m.avgCostPerRunUsd !== null ? ` (${money(m.avgCostPerRunUsd)} per run)` : ""}`);
  lines.push(`Score: ${ctx.score.score === null ? "none yet" : `${Math.round(ctx.score.score)}/100 over ${ctx.score.sampleSize.runs} runs`}`);
  for (const kpi of m.kpis) {
    if (kpi.actual === null) continue;
    lines.push(`KPI ${kpi.name}: ${formatKpiValue(kpi.actual, kpi.unit)} vs target ${formatKpiValue(kpi.target, kpi.unit)} → ${kpi.met ? "met" : "missed"}`);
  }
  const method = ctx.lastRunMethod;
  if (method) {
    const read = [
      method.searches.length > 0 ? `${method.searches.length} web searches (${method.searches.slice(0, 3).map((q) => `“${clip(q, 60)}”`).join(", ")})` : null,
      method.pagesRead > 0 ? `${method.pagesRead} pages read on ${method.hosts.join(", ") || "the web"}` : null,
      method.datasets.length > 0 ? `datasets: ${method.datasets.join(", ")}` : null,
      method.collected !== null && method.kept !== null ? `${method.kept} of ${method.collected} records kept after cleaning` : null,
    ].filter((x): x is string => x !== null);
    if (read.length > 0) lines.push("", `How the last successful run (${shortDate(method.at)}) worked: ${read.join("; ")}`);
  }
  if (ctx.activeInstructions.length > 0) lines.push("", `One-off instructions waiting for the next run: ${ctx.activeInstructions.map((i) => `“${clip(i, 120)}”`).join("; ")}`);
  if (ctx.pendingProposal) lines.push(`A proposed version ${ctx.pendingProposal.version} is awaiting the manager's decision.`);
  return lines.join("\n");
}
