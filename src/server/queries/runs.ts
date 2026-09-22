import type {
  ApprovalStatus,
  DeliverableFormat,
  DeliverableStatus,
  EvaluationType,
  RunStatus,
  RunStepKind,
  RunStepStatus,
  RunTrigger,
  ToolCallStatus,
  WorkerVersionStatus,
} from "@prisma/client";
import { db } from "@/server/db";
import { safeParseBlueprint, DEFAULT_EVALUATION_WEIGHTS } from "@/server/domain/blueprint";
import { EvaluationDetailsSchema, type EvaluationDetails } from "@/server/domain/evaluation";
import { notFound } from "@/server/errors";
import { runScore } from "@/server/evaluation";
import { RunInputSchema, RunOutputSchema, type RunInput, type RunLiveView, type RunOutput } from "@/server/runtime/types";

/**
 * Read models for /runs/[runId] and GET /api/runs/[runId]. Everything is org-scoped and returns plain JSON
 * (Decimal → Number, Date → ISO string) so it can cross into client components untouched.
 */

/** A SUCCEEDED run keeps polling this long for its evaluation before the page gives up and shows what it has. */
export const EVALUATION_GRACE_MS = 3 * 60_000;

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

// ── Live view ───────────────────────────────────────────────────────────────

export async function getRunLiveView(organizationId: string, runId: string): Promise<RunLiveView> {
  const run = await db.run.findFirst({
    where: { id: runId, organizationId },
    select: {
      id: true,
      status: true,
      trigger: true,
      simulated: true,
      attempt: true,
      maxAttempts: true,
      error: true,
      costUsd: true,
      inputTokens: true,
      outputTokens: true,
      durationMs: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      steps: {
        orderBy: { index: "asc" },
        select: {
          id: true,
          index: true,
          attempt: true,
          componentId: true,
          kind: true,
          status: true,
          title: true,
          detail: true,
          error: true,
          startedAt: true,
          durationMs: true,
        },
      },
      approvals: {
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" },
        select: { id: true, title: true, description: true, toolName: true, payload: true },
      },
      deliverables: { orderBy: { createdAt: "asc" }, select: { id: true } },
      evaluations: { select: { type: true } },
    },
  });
  if (!run) throw notFound("Run");

  return {
    run: {
      id: run.id,
      status: run.status,
      trigger: run.trigger,
      simulated: run.simulated,
      attempt: run.attempt,
      maxAttempts: run.maxAttempts,
      error: run.error,
      costUsd: Number(run.costUsd),
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      durationMs: run.durationMs,
      createdAt: run.createdAt.toISOString(),
      startedAt: iso(run.startedAt),
      finishedAt: iso(run.finishedAt),
    },
    steps: run.steps.map((s) => ({
      id: s.id,
      index: s.index,
      attempt: s.attempt,
      componentId: s.componentId,
      kind: s.kind,
      status: s.status,
      title: s.title,
      detail: s.detail,
      error: s.error,
      startedAt: s.startedAt.toISOString(),
      durationMs: s.durationMs,
    })),
    // Only approvals of a run that is still waiting are actionable; a PENDING row on a cancelled run is about to expire.
    pendingApprovals:
      run.status === "WAITING_FOR_APPROVAL"
        ? run.approvals.map((a) => ({ id: a.id, title: a.title, description: a.description, toolName: a.toolName, payload: a.payload }))
        : [],
    deliverableIds: run.deliverables.map((d) => d.id),
    evaluationPending: isEvaluationPending(run.status, run.finishedAt, run.evaluations),
  };
}

/** SUCCEEDED, no automated verdict yet, and finished recently enough that one is still expected. */
export function isEvaluationPending(
  status: RunStatus,
  finishedAt: Date | null,
  evaluations: ReadonlyArray<{ type: EvaluationType }>,
  now: Date = new Date(),
): boolean {
  if (status !== "SUCCEEDED" || !finishedAt) return false;
  if (evaluations.some((e) => e.type === "DETERMINISTIC" || e.type === "LLM_JUDGE")) return false;
  return now.getTime() - finishedAt.getTime() < EVALUATION_GRACE_MS;
}

// ── Detail view ─────────────────────────────────────────────────────────────

export interface RunModelCallView {
  id: string;
  purpose: string;
  provider: string;
  model: string;
  tier: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  simulated: boolean;
  request: unknown;
  response: unknown;
  error: string | null;
  createdAt: string;
}

export interface RunToolCallView {
  id: string;
  toolName: string;
  status: ToolCallStatus;
  input: unknown;
  output: unknown;
  error: string | null;
  latencyMs: number | null;
  costUsd: number;
  simulated: boolean;
  createdAt: string;
  finishedAt: string | null;
}

export interface RunApprovalView {
  id: string;
  title: string;
  description: string | null;
  toolName: string;
  payload: unknown;
  status: ApprovalStatus;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface RunStepDetailView {
  id: string;
  index: number;
  attempt: number;
  componentId: string | null;
  kind: RunStepKind;
  status: RunStepStatus;
  title: string;
  detail: string | null;
  error: string | null;
  input: unknown;
  output: unknown;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  modelCalls: RunModelCallView[];
  toolCalls: RunToolCallView[];
  /** For APPROVAL steps: the request this step is waiting on / was decided by. */
  approval: RunApprovalView | null;
}

export interface RunDeliverableView {
  id: string;
  title: string;
  summary: string | null;
  format: DeliverableFormat;
  status: DeliverableStatus;
  recordCount: number | null;
  createdAt: string;
}

export interface RunEvaluationView {
  id: string;
  type: EvaluationType;
  /** 0..1 */
  score: number;
  passed: boolean;
  summary: string | null;
  details: EvaluationDetails | null;
  deliverableId: string | null;
  createdAt: string;
}

export interface RunDetail {
  live: RunLiveView;
  worker: { id: string; name: string; title: string; avatarColor: string };
  job: { id: string; title: string };
  version: { id: string; version: number; status: WorkerVersionStatus };
  requestedByName: string | null;
  input: RunInput;
  output: RunOutput | null;
  /** This run's own blended score on 0..100 (null until evaluated; 0 for a failed run). */
  score: number | null;
  deliverables: RunDeliverableView[];
  evaluations: RunEvaluationView[];
  approvals: RunApprovalView[];
  steps: RunStepDetailView[];
  usage: { costUsd: number; inputTokens: number; outputTokens: number; modelCalls: number; toolCalls: number };
  checkpoint: unknown;
  /** Queue/lease fields for the debug trace. */
  queue: { availableAt: string; lockedBy: string | null; lockedAt: string | null; heartbeatAt: string | null; updatedAt: string };
}

function parseDetails(value: unknown): EvaluationDetails | null {
  const parsed = EvaluationDetailsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function approvalIdOf(input: unknown): string | null {
  const id = (input as { approvalId?: unknown } | null)?.approvalId;
  return typeof id === "string" ? id : null;
}

export async function getRunDetail(organizationId: string, runId: string): Promise<RunDetail> {
  const run = await db.run.findFirst({
    where: { id: runId, organizationId },
    include: {
      worker: { select: { id: true, name: true, title: true, avatarColor: true } },
      job: { select: { id: true, title: true } },
      workerVersion: { select: { id: true, version: true, status: true, blueprint: true } },
      steps: {
        orderBy: { index: "asc" },
        include: {
          modelCalls: { orderBy: { createdAt: "asc" } },
          toolCalls: { orderBy: { createdAt: "asc" } },
        },
      },
      approvals: { orderBy: { createdAt: "asc" } },
      deliverables: { orderBy: { createdAt: "asc" } },
      evaluations: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!run) throw notFound("Run");

  const userIds = new Set<string>();
  if (run.requestedById) userIds.add(run.requestedById);
  for (const a of run.approvals) if (a.decidedById) userIds.add(a.decidedById);
  const users = userIds.size
    ? await db.user.findMany({ where: { id: { in: [...userIds] }, organizationId }, select: { id: true, name: true } })
    : [];
  const nameOf = (id: string | null): string | null => (id ? (users.find((u) => u.id === id)?.name ?? null) : null);

  const approvals: RunApprovalView[] = run.approvals.map((a) => ({
    id: a.id,
    title: a.title,
    description: a.description,
    toolName: a.toolName,
    payload: a.payload,
    status: a.status,
    decidedByName: nameOf(a.decidedById),
    decidedAt: iso(a.decidedAt),
    decisionNote: a.decisionNote,
    createdAt: a.createdAt.toISOString(),
  }));
  const approvalById = new Map(approvals.map((a) => [a.id, a]));

  // The runtime links an APPROVAL step to its request via step.input.approvalId. Hand-written history (seed,
  // fixtures) may omit that, so unmatched APPROVAL steps fall back to pairing with unmatched approvals in order.
  const linkedIds = new Set(run.steps.filter((s) => s.kind === "APPROVAL").map((s) => approvalIdOf(s.input)).filter((id): id is string => !!id));
  const unlinkedApprovals = approvals.filter((a) => !linkedIds.has(a.id));
  const approvalForStep = (step: { kind: RunStepKind; input: unknown }): RunApprovalView | null => {
    if (step.kind !== "APPROVAL") return null;
    const id = approvalIdOf(step.input);
    if (id) return approvalById.get(id) ?? null;
    return unlinkedApprovals.shift() ?? null;
  };

  const steps: RunStepDetailView[] = run.steps.map((s) => ({
    id: s.id,
    index: s.index,
    attempt: s.attempt,
    componentId: s.componentId,
    kind: s.kind,
    status: s.status,
    title: s.title,
    detail: s.detail,
    error: s.error,
    input: s.input,
    output: s.output,
    startedAt: s.startedAt.toISOString(),
    finishedAt: iso(s.finishedAt),
    durationMs: s.durationMs,
    modelCalls: s.modelCalls.map((m) => ({
      id: m.id,
      purpose: m.purpose,
      provider: m.provider,
      model: m.model,
      tier: m.tier,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      costUsd: Number(m.costUsd),
      latencyMs: m.latencyMs,
      simulated: m.simulated,
      request: m.request,
      response: m.response,
      error: m.error,
      createdAt: m.createdAt.toISOString(),
    })),
    toolCalls: s.toolCalls.map((t) => ({
      id: t.id,
      toolName: t.toolName,
      status: t.status,
      input: t.input,
      output: t.output,
      error: t.error,
      latencyMs: t.latencyMs,
      costUsd: Number(t.costUsd),
      simulated: t.simulated,
      createdAt: t.createdAt.toISOString(),
      finishedAt: iso(t.finishedAt),
    })),
    approval: approvalForStep(s),
  }));

  const input = RunInputSchema.safeParse(run.input ?? {});
  const output = RunOutputSchema.safeParse(run.output);
  const blueprint = safeParseBlueprint(run.workerVersion.blueprint);
  const weights = blueprint.success ? blueprint.data.evaluation.weights : { ...DEFAULT_EVALUATION_WEIGHTS };

  const live: RunLiveView = {
    run: {
      id: run.id,
      status: run.status,
      trigger: run.trigger,
      simulated: run.simulated,
      attempt: run.attempt,
      maxAttempts: run.maxAttempts,
      error: run.error,
      costUsd: Number(run.costUsd),
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      durationMs: run.durationMs,
      createdAt: run.createdAt.toISOString(),
      startedAt: iso(run.startedAt),
      finishedAt: iso(run.finishedAt),
    },
    steps: steps.map(({ id, index, attempt, componentId, kind, status, title, detail, error, startedAt, durationMs }) => ({
      id,
      index,
      attempt,
      componentId,
      kind,
      status,
      title,
      detail,
      error,
      startedAt,
      durationMs,
    })),
    pendingApprovals:
      run.status === "WAITING_FOR_APPROVAL"
        ? approvals
            .filter((a) => a.status === "PENDING")
            .map((a) => ({ id: a.id, title: a.title, description: a.description, toolName: a.toolName, payload: a.payload }))
        : [],
    deliverableIds: run.deliverables.map((d) => d.id),
    evaluationPending: isEvaluationPending(run.status, run.finishedAt, run.evaluations),
  };

  return {
    live,
    worker: run.worker,
    job: run.job,
    version: { id: run.workerVersion.id, version: run.workerVersion.version, status: run.workerVersion.status },
    requestedByName: nameOf(run.requestedById),
    input: input.success ? input.data : { instructions: [], params: {} },
    output: output.success ? output.data : null,
    score: runScore(run.status, run.evaluations, weights),
    deliverables: run.deliverables.map((d) => ({
      id: d.id,
      title: d.title,
      summary: d.summary,
      format: d.format,
      status: d.status,
      recordCount: Array.isArray(d.data) ? d.data.length : null,
      createdAt: d.createdAt.toISOString(),
    })),
    evaluations: run.evaluations.map((e) => ({
      id: e.id,
      type: e.type,
      score: e.score,
      passed: e.passed,
      summary: e.summary,
      details: parseDetails(e.details),
      deliverableId: e.deliverableId,
      createdAt: e.createdAt.toISOString(),
    })),
    approvals,
    steps,
    usage: {
      costUsd: Number(run.costUsd),
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      modelCalls: steps.reduce((n, s) => n + s.modelCalls.length, 0),
      toolCalls: steps.reduce((n, s) => n + s.toolCalls.length, 0),
    },
    checkpoint: run.checkpoint,
    queue: {
      availableAt: run.availableAt.toISOString(),
      lockedBy: run.lockedBy,
      lockedAt: iso(run.lockedAt),
      heartbeatAt: iso(run.heartbeatAt),
      updatedAt: run.updatedAt.toISOString(),
    },
  };
}

// ── Runs index ──────────────────────────────────────────────────────────────

export interface RunListItem {
  id: string;
  status: RunStatus;
  trigger: RunTrigger;
  simulated: boolean;
  attempt: number;
  error: string | null;
  costUsd: number;
  durationMs: number | null;
  createdAt: string;
  finishedAt: string | null;
  worker: { id: string; name: string; avatarColor: string };
  job: { id: string; title: string };
  deliverable: { id: string; title: string } | null;
}

export interface RunListFilters {
  status?: RunStatus;
  workerId?: string;
  limit?: number;
}

const RUN_STATUSES: ReadonlySet<string> = new Set<RunStatus>(["QUEUED", "RUNNING", "WAITING_FOR_APPROVAL", "SUCCEEDED", "FAILED", "CANCELLED"]);

export function isRunStatus(value: string | undefined): value is RunStatus {
  return !!value && RUN_STATUSES.has(value);
}

export interface RunWorkerOption {
  id: string;
  name: string;
  title: string;
  avatarColor: string;
}

/** Workers that have at least one run — the options for the index filter. */
export async function listRunWorkers(organizationId: string): Promise<RunWorkerOption[]> {
  return db.worker.findMany({
    where: { organizationId, runs: { some: {} } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, title: true, avatarColor: true },
  });
}

export async function listRuns(organizationId: string, filters: RunListFilters = {}): Promise<RunListItem[]> {
  const rows = await db.run.findMany({
    where: {
      organizationId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.workerId ? { workerId: filters.workerId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(200, Math.max(1, filters.limit ?? 50)),
    select: {
      id: true,
      status: true,
      trigger: true,
      simulated: true,
      attempt: true,
      error: true,
      costUsd: true,
      durationMs: true,
      createdAt: true,
      finishedAt: true,
      worker: { select: { id: true, name: true, avatarColor: true } },
      job: { select: { id: true, title: true } },
      deliverables: { orderBy: { createdAt: "asc" }, take: 1, select: { id: true, title: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    trigger: r.trigger,
    simulated: r.simulated,
    attempt: r.attempt,
    error: r.error,
    costUsd: Number(r.costUsd),
    durationMs: r.durationMs,
    createdAt: r.createdAt.toISOString(),
    finishedAt: iso(r.finishedAt),
    worker: r.worker,
    job: r.job,
    deliverable: r.deliverables[0] ?? null,
  }));
}
