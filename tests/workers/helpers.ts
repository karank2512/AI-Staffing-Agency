import type { ActivityType, DeliverableStatus, RunStatus } from "@prisma/client";
import { db, toJson } from "@/server/db";
import type { createTestOrg } from "../helpers/factory";
import type { createHiredWorker } from "../helpers/fixtures";

/** Rows written directly with `db`, so the workers suites depend on nothing but the shared fixtures. */

export type TestOrg = Awaited<ReturnType<typeof createTestOrg>>;
export type Hired = Awaited<ReturnType<typeof createHiredWorker>>;

export interface CreateRunOptions {
  status?: RunStatus;
  costUsd?: number;
  error?: string;
  /** Defaults to now (terminal statuses get finishedAt = createdAt). */
  createdAt?: Date;
  workerVersionId?: string;
}

export async function createRun(hired: Hired, opts: CreateRunOptions = {}) {
  const status = opts.status ?? "SUCCEEDED";
  const terminal = status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED";
  const createdAt = opts.createdAt ?? new Date();
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
      durationMs: terminal ? 45_000 : null,
      error: opts.error,
      input: toJson({ instructions: [], params: {} }),
      createdAt,
      startedAt: status === "QUEUED" ? null : createdAt,
      finishedAt: terminal ? createdAt : null,
      ...(status === "RUNNING" ? { lockedBy: "test-executor", lockedAt: createdAt, heartbeatAt: createdAt } : {}),
    },
  });
}

export interface CreateDeliverableOptions {
  title?: string;
  content?: string;
  data?: unknown;
  status?: DeliverableStatus;
  feedback?: string;
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
      title: opts.title ?? "Weekly AI Infra Funding Report — Sep 16",
      content: opts.content ?? "# Weekly AI Infra Funding Report\n\n## Summary\n\nSix startups raised money.\n\n## Top rounds\n\n| company |\n| --- |\n| Vectorline |",
      format: "MARKDOWN",
      status: opts.status ?? "PENDING_REVIEW",
      feedback: opts.feedback,
      createdAt: run.createdAt,
      ...(opts.data === undefined ? {} : { data: toJson(opts.data) }),
    },
  });
}

export async function createJudgeEvaluation(hired: Hired, args: { runId: string; deliverableId: string; score: number; reasoning: string }) {
  return db.evaluation.create({
    data: {
      organizationId: hired.worker.organizationId,
      workerId: hired.worker.id,
      workerVersionId: hired.version.id,
      runId: args.runId,
      deliverableId: args.deliverableId,
      type: "LLM_JUDGE",
      score: args.score,
      passed: args.score >= 0.7,
      summary: args.reasoning,
      details: toJson({ kind: "llm_judge", criteria: [], overallReasoning: args.reasoning, model: "mock-standard", simulated: true }),
    },
  });
}

export function records(count: number): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, i) => ({
    company: `Company ${i + 1}`,
    stage: "Seed",
    amount_usd: 1_000_000 * (i + 1),
    lead_investor: "Harbor Seed",
    category: "vector databases",
    source_url: `https://news.example/company-${i + 1}`,
  }));
}

export async function activityOf(organizationId: string, workerId: string, type?: ActivityType) {
  return db.activityEvent.findMany({ where: { organizationId, workerId, ...(type ? { type } : {}) }, orderBy: { createdAt: "asc" } });
}

export async function loadWorkerRow(workerId: string) {
  return db.worker.findUniqueOrThrow({ where: { id: workerId } });
}

export async function loadVersionRow(versionId: string) {
  return db.workerVersion.findUniqueOrThrow({ where: { id: versionId } });
}

export async function grantsOf(workerId: string) {
  const rows = await db.workerToolGrant.findMany({ where: { workerId }, orderBy: { toolName: "asc" } });
  return new Map(rows.map((g) => [g.toolName, g] as const));
}

export const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
