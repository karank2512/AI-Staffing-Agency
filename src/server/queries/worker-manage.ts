import type {
  MessageClassification,
  MessageRole,
  ToolCallStatus,
  UserRole,
  VersionChangeReason,
  WorkerStatus,
  WorkerVersionStatus,
} from "@prisma/client";
import { db } from "@/server/db";
import {
  describeCadence,
  safeParseBlueprint,
  workerFieldsToCadence,
  type BlueprintDiffEntry,
  type Cadence,
  type Kpi,
  type ModelTier,
  type ReplacementAnalysis,
  type RunLimits,
  type WorkerBlueprint,
} from "@/server/domain";
import { notFound } from "@/server/errors";
import { tools } from "@/server/tools";
import type { ToolCategory, ToolSideEffect } from "@/server/tools/types";
import { getVersionComparison, listMessages, listVersions, type VersionSummary } from "@/server/workers";
import { permissionSubset, WORKER_PERMISSION_KEYS, type WorkerPermissions } from "./permissions";

/**
 * Read models for the "manage" side of a worker profile — Permissions, Talk to worker, Versions and Debug tabs —
 * and for the replace/compare page. Everything returned is plain JSON (ISO dates, numbers) so it can cross into
 * client leaves untouched. All lookups are org-scoped through the Worker row.
 */

const DEBUG_CALL_LIMIT = 20;
const CHAT_HISTORY_LIMIT = 100;

interface WorkerCore {
  id: string;
  name: string;
  title: string;
  avatarColor: string;
  status: WorkerStatus;
  currentVersionId: string | null;
  nextRunAt: string | null;
}

async function loadWorkerCore(organizationId: string, workerId: string) {
  const worker = await db.worker.findFirst({
    where: { id: workerId, organizationId },
    include: { currentVersion: { select: { id: true, version: true, status: true, blueprint: true, lockedAt: true } } },
  });
  if (!worker) throw notFound("Worker");
  return worker;
}

function coreOf(worker: Awaited<ReturnType<typeof loadWorkerCore>>): WorkerCore {
  return {
    id: worker.id,
    name: worker.name,
    title: worker.title,
    avatarColor: worker.avatarColor,
    status: worker.status,
    currentVersionId: worker.currentVersionId,
    nextRunAt: worker.nextRunAt?.toISOString() ?? null,
  };
}

/** A stored blueprint that no longer parses is shown raw on the Debug tab instead of breaking the page. */
function parseBlueprintOrNull(value: unknown): WorkerBlueprint | null {
  const parsed = safeParseBlueprint(value);
  return parsed.success ? parsed.data : null;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

export const replaceHref = (workerId: string, versionId: string): string => `/workers/${workerId}/replace/${versionId}`;

// ── Permissions ─────────────────────────────────────────────────────────────

export interface ToolGrantView {
  toolName: string;
  displayName: string;
  humanDescription: string;
  category: ToolCategory | null;
  sideEffect: ToolSideEffect | null;
  /** Registry default — a tool that ships approval-gated can never be loosened. */
  defaultRequiresApproval: boolean;
  /** Why the worker needs it, from the current blueprint. null when the grant outlived the design. */
  reason: string | null;
  inBlueprint: boolean;
  hasGrant: boolean;
  requiresApproval: boolean;
  revoked: boolean;
  revokedAt: string | null;
  maxCallsPerRun: number | null;
  updatedAt: string | null;
}

export interface WorkerPermissionsView {
  worker: WorkerCore;
  grants: ToolGrantView[];
  schedule: Cadence;
  scheduleLabel: string;
  limits: RunLimits | null;
  /** Estimated cost per run from the current blueprint, for context next to the cost limit. */
  estimatedCostPerRunUsd: number | null;
  currentVersion: { id: string; version: number } | null;
  /** Changing a grant or a schedule is workers.manage; the page disables the switches for everyone else. */
  permissions: WorkerPermissions;
}

export async function getWorkerPermissions(
  organizationId: string,
  workerId: string,
  opts: { role?: UserRole } = {},
): Promise<WorkerPermissionsView> {
  const worker = await loadWorkerCore(organizationId, workerId);
  const blueprint = worker.currentVersion ? parseBlueprintOrNull(worker.currentVersion.blueprint) : null;
  const grants = await db.workerToolGrant.findMany({ where: { workerId: worker.id }, orderBy: { createdAt: "asc" } });
  const grantByTool = new Map(grants.map((g) => [g.toolName, g] as const));
  const requirementByTool = new Map((blueprint?.tools ?? []).map((t) => [t.toolName, t] as const));

  // Blueprint order first (that is how the proposal card listed them), then grants the design no longer mentions.
  const names = [...requirementByTool.keys(), ...grants.map((g) => g.toolName).filter((n) => !requirementByTool.has(n))];

  const views: ToolGrantView[] = names.map((toolName) => {
    const definition = tools.get(toolName);
    const grant = grantByTool.get(toolName);
    const requirement = requirementByTool.get(toolName);
    const config = asRecord(grant?.config);
    const maxCalls = config?.maxCallsPerRun;
    return {
      toolName,
      displayName: definition?.displayName ?? toolName,
      humanDescription: definition?.humanDescription ?? "",
      category: definition?.category ?? null,
      sideEffect: definition?.sideEffect ?? null,
      defaultRequiresApproval: definition?.defaultRequiresApproval ?? false,
      reason: requirement?.reason ?? null,
      inBlueprint: requirement !== undefined,
      hasGrant: grant !== undefined,
      requiresApproval: grant?.requiresApproval ?? requirement?.requiresApproval ?? definition?.defaultRequiresApproval ?? false,
      revoked: grant ? grant.revokedAt !== null : false,
      revokedAt: grant?.revokedAt?.toISOString() ?? null,
      maxCallsPerRun: typeof maxCalls === "number" && Number.isFinite(maxCalls) ? maxCalls : null,
      updatedAt: grant?.updatedAt.toISOString() ?? null,
    };
  });

  const schedule = workerFieldsToCadence(worker);
  return {
    worker: coreOf(worker),
    grants: views,
    schedule,
    scheduleLabel: describeCadence(schedule),
    limits: blueprint?.limits ?? null,
    estimatedCostPerRunUsd: blueprint?.costEstimate.perRunUsd ?? null,
    currentVersion: worker.currentVersion ? { id: worker.currentVersion.id, version: worker.currentVersion.version } : null,
    permissions: permissionSubset(opts.role, WORKER_PERMISSION_KEYS),
  };
}

// ── Talk to worker ──────────────────────────────────────────────────────────

export interface ChatMessageView {
  id: string;
  role: MessageRole;
  content: string;
  classification: MessageClassification | null;
  createdAt: string;
  simulated: boolean;
  /** For spec changes: the proposed version and where to review it. */
  proposedVersionId: string | null;
  proposedVersion: number | null;
  proposalStatus: WorkerVersionStatus | null;
  href: string | null;
  normalizedInstruction: string | null;
}

export interface WorkerChatView {
  worker: WorkerCore;
  messages: ChatMessageView[];
  /** One-off instructions parked for the next run. */
  pendingInstructions: number;
  permissions: WorkerPermissions;
}

function messageView(
  m: Awaited<ReturnType<typeof listMessages>>[number],
  proposals: Map<string, { status: WorkerVersionStatus; version: number }>,
): ChatMessageView {
  const meta = m.metadata ?? {};
  const proposedVersionId = typeof meta.proposedVersionId === "string" ? meta.proposedVersionId : null;
  const proposal = proposedVersionId ? (proposals.get(proposedVersionId) ?? null) : null;
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    classification: m.classification,
    createdAt: m.createdAt,
    simulated: meta.simulated === true,
    proposedVersionId,
    proposedVersion: proposal?.version ?? (typeof meta.version === "number" ? meta.version : null),
    proposalStatus: proposal?.status ?? null,
    href: typeof meta.href === "string" ? meta.href : null,
    normalizedInstruction: typeof meta.normalizedInstruction === "string" ? meta.normalizedInstruction : null,
  };
}

export async function getWorkerChat(
  organizationId: string,
  workerId: string,
  opts: { role?: UserRole } = {},
): Promise<WorkerChatView> {
  const worker = await loadWorkerCore(organizationId, workerId);
  const [messages, pendingInstructions] = await Promise.all([
    listMessages(organizationId, worker.id, CHAT_HISTORY_LIMIT),
    db.workerMessage.count({ where: { organizationId, workerId: worker.id, role: "USER", classification: "TEMPORARY_INSTRUCTION", instructionActive: true } }),
  ]);

  // The "Review proposed change" button should know whether the proposal is still open.
  const proposalIds = messages.map((m) => (typeof m.metadata?.proposedVersionId === "string" ? m.metadata.proposedVersionId : null)).filter((id): id is string => id !== null);
  const proposals = proposalIds.length
    ? await db.workerVersion.findMany({ where: { id: { in: proposalIds }, workerId: worker.id }, select: { id: true, status: true, version: true } })
    : [];
  const proposalById = new Map(proposals.map((p) => [p.id, { status: p.status, version: p.version }] as const));

  return {
    worker: coreOf(worker),
    messages: messages.map((m) => messageView(m, proposalById)),
    pendingInstructions,
    permissions: permissionSubset(opts.role, WORKER_PERMISSION_KEYS),
  };
}

/**
 * The messages a send just produced (user + reply), in chronological order, so the composer can append the real
 * exchange in place of its optimistic bubble without re-fetching the whole conversation.
 */
export async function getChatExchange(organizationId: string, workerId: string, messageIds: string[]): Promise<ChatMessageView[]> {
  if (messageIds.length === 0) return [];
  const worker = await loadWorkerCore(organizationId, workerId);
  const rows = await db.workerMessage.findMany({
    where: { id: { in: messageIds }, organizationId, workerId: worker.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, role: true, content: true, classification: true, metadata: true, createdAt: true },
  });
  const proposalIds = rows.map((m) => (typeof asRecord(m.metadata)?.proposedVersionId === "string" ? (asRecord(m.metadata)?.proposedVersionId as string) : null)).filter((id): id is string => id !== null);
  const proposals = proposalIds.length
    ? await db.workerVersion.findMany({ where: { id: { in: proposalIds }, workerId: worker.id }, select: { id: true, status: true, version: true } })
    : [];
  const proposalById = new Map(proposals.map((p) => [p.id, { status: p.status, version: p.version }] as const));
  return rows.map((m) =>
    messageView(
      { id: m.id, role: m.role, content: m.content, classification: m.classification, metadata: asRecord(m.metadata), createdAt: m.createdAt.toISOString() },
      proposalById,
    ),
  );
}

// ── Versions ────────────────────────────────────────────────────────────────

export interface VersionTierChip {
  componentId: string;
  name: string;
  tier: ModelTier;
}

export interface VersionListItem {
  id: string;
  version: number;
  status: WorkerVersionStatus;
  changeReason: VersionChangeReason;
  changeSummary: string | null;
  createdAt: string;
  activatedAt: string | null;
  retiredAt: string | null;
  locked: boolean;
  isCurrent: boolean;
  parentVersionId: string | null;
  runCount: number;
  /** 0..100 or null when the version has no rated runs. */
  score: number | null;
  successRate: number | null;
  acceptanceRate: number | null;
  avgCostPerRunUsd: number | null;
  estimatedCostPerRunUsd: number;
  estimatedMonthlyUsd: number;
  scheduleLabel: string;
  tiers: VersionTierChip[];
  stepCount: number;
  toolNames: string[];
  /** Where to review (PROPOSED) or compare (everything after v1). */
  href: string | null;
}

export interface WorkerVersionsView {
  worker: WorkerCore;
  versions: VersionListItem[];
  openProposal: { id: string; version: number; changeReason: VersionChangeReason; href: string } | null;
  canPropose: boolean;
  permissions: WorkerPermissions;
}

function tierChips(blueprint: WorkerBlueprint): VersionTierChip[] {
  return blueprint.components.flatMap((c) => (c.type === "agent" ? [{ componentId: c.id, name: c.name, tier: c.modelTier }] : []));
}

function versionListItem(workerId: string, summary: VersionSummary, parentVersionId: string | null, currentVersionId: string | null): VersionListItem {
  const bp = summary.blueprint;
  const href = summary.status === "PROPOSED" || parentVersionId ? replaceHref(workerId, summary.id) : null;
  return {
    id: summary.id,
    version: summary.version,
    status: summary.status,
    changeReason: summary.changeReason,
    changeSummary: summary.changeSummary,
    createdAt: summary.createdAt,
    activatedAt: summary.activatedAt,
    retiredAt: summary.retiredAt,
    locked: summary.locked,
    isCurrent: summary.id === currentVersionId,
    parentVersionId,
    runCount: summary.runCount,
    score: summary.score.score,
    successRate: summary.metrics?.successRate ?? null,
    acceptanceRate: summary.metrics?.acceptanceRate ?? null,
    avgCostPerRunUsd: summary.metrics?.avgCostPerRunUsd ?? null,
    estimatedCostPerRunUsd: bp.costEstimate.perRunUsd,
    estimatedMonthlyUsd: bp.costEstimate.monthlyUsd,
    scheduleLabel: describeCadence(bp.schedule),
    tiers: tierChips(bp),
    stepCount: bp.components.length,
    toolNames: bp.tools.map((t) => t.toolName),
    href,
  };
}

export async function getWorkerVersions(
  organizationId: string,
  workerId: string,
  opts: { role?: UserRole } = {},
): Promise<WorkerVersionsView> {
  const worker = await loadWorkerCore(organizationId, workerId);
  const [summaries, lineage] = await Promise.all([
    listVersions(organizationId, worker.id),
    db.workerVersion.findMany({ where: { workerId: worker.id }, select: { id: true, parentVersionId: true } }),
  ]);
  const parentById = new Map(lineage.map((v) => [v.id, v.parentVersionId] as const));
  const versions = summaries.map((s) => versionListItem(worker.id, s, parentById.get(s.id) ?? null, worker.currentVersionId));
  const open = versions.find((v) => v.status === "PROPOSED") ?? null;
  return {
    worker: coreOf(worker),
    versions,
    openProposal: open ? { id: open.id, version: open.version, changeReason: open.changeReason, href: replaceHref(worker.id, open.id) } : null,
    canPropose: worker.status !== "RETIRED" && worker.currentVersionId !== null,
    permissions: permissionSubset(opts.role, WORKER_PERMISSION_KEYS),
  };
}

// ── Debug ───────────────────────────────────────────────────────────────────

export interface DebugModelCall {
  id: string;
  runId: string | null;
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

export interface DebugToolCall {
  id: string;
  runId: string;
  toolName: string;
  status: ToolCallStatus;
  attempt: number;
  input: unknown;
  output: unknown;
  error: string | null;
  latencyMs: number | null;
  costUsd: number;
  simulated: boolean;
  createdAt: string;
}

export interface DebugGrant {
  id: string;
  toolName: string;
  requiresApproval: boolean;
  config: unknown;
  grantedById: string | null;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
}

export interface WorkerDebugView {
  worker: WorkerCore;
  currentVersion: { id: string; version: number; status: WorkerVersionStatus; locked: boolean } | null;
  /** Parsed blueprint, or the raw stored JSON when it no longer matches the schema. */
  blueprint: unknown;
  blueprintValid: boolean;
  latestRun: {
    id: string;
    status: string;
    trigger: string;
    attempt: number;
    error: string | null;
    simulated: boolean;
    createdAt: string;
    finishedAt: string | null;
    checkpoint: unknown;
  } | null;
  modelCalls: DebugModelCall[];
  toolCalls: DebugToolCall[];
  grants: DebugGrant[];
}

export async function getWorkerDebug(organizationId: string, workerId: string): Promise<WorkerDebugView> {
  const worker = await loadWorkerCore(organizationId, workerId);
  const [latestRun, modelCalls, toolCalls, grants] = await Promise.all([
    db.run.findFirst({
      where: { organizationId, workerId: worker.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, trigger: true, attempt: true, error: true, simulated: true, createdAt: true, finishedAt: true, checkpoint: true },
    }),
    db.modelCall.findMany({ where: { organizationId, workerId: worker.id }, orderBy: { createdAt: "desc" }, take: DEBUG_CALL_LIMIT }),
    // ToolCall has no organizationId: scope through its run.
    db.toolCall.findMany({ where: { workerId: worker.id, run: { organizationId } }, orderBy: { createdAt: "desc" }, take: DEBUG_CALL_LIMIT }),
    db.workerToolGrant.findMany({ where: { workerId: worker.id }, orderBy: { toolName: "asc" } }),
  ]);

  const parsed = worker.currentVersion ? parseBlueprintOrNull(worker.currentVersion.blueprint) : null;
  return {
    worker: coreOf(worker),
    currentVersion: worker.currentVersion
      ? { id: worker.currentVersion.id, version: worker.currentVersion.version, status: worker.currentVersion.status, locked: worker.currentVersion.lockedAt !== null }
      : null,
    blueprint: parsed ?? worker.currentVersion?.blueprint ?? null,
    blueprintValid: parsed !== null,
    latestRun: latestRun
      ? {
          id: latestRun.id,
          status: latestRun.status,
          trigger: latestRun.trigger,
          attempt: latestRun.attempt,
          error: latestRun.error,
          simulated: latestRun.simulated,
          createdAt: latestRun.createdAt.toISOString(),
          finishedAt: latestRun.finishedAt?.toISOString() ?? null,
          checkpoint: latestRun.checkpoint,
        }
      : null,
    modelCalls: modelCalls.map((c) => ({
      id: c.id,
      runId: c.runId,
      purpose: c.purpose,
      provider: c.provider,
      model: c.model,
      tier: c.tier,
      inputTokens: c.inputTokens,
      outputTokens: c.outputTokens,
      costUsd: Number(c.costUsd),
      latencyMs: c.latencyMs,
      simulated: c.simulated,
      request: c.request,
      response: c.response,
      error: c.error,
      createdAt: c.createdAt.toISOString(),
    })),
    toolCalls: toolCalls.map((t) => ({
      id: t.id,
      runId: t.runId,
      toolName: t.toolName,
      status: t.status,
      attempt: t.attempt,
      input: t.input,
      output: t.output,
      error: t.error,
      latencyMs: t.latencyMs,
      costUsd: Number(t.costUsd),
      simulated: t.simulated,
      createdAt: t.createdAt.toISOString(),
    })),
    grants: grants.map((g) => ({
      id: g.id,
      toolName: g.toolName,
      requiresApproval: g.requiresApproval,
      config: g.config,
      grantedById: g.grantedById,
      createdAt: g.createdAt.toISOString(),
      updatedAt: g.updatedAt.toISOString(),
      revokedAt: g.revokedAt?.toISOString() ?? null,
    })),
  };
}

// ── Replace / compare page ──────────────────────────────────────────────────

export interface VersionCardStep {
  id: string;
  name: string;
  kind: "agent" | "deterministic";
  /** Agents: model tier. Deterministic steps: the operation ("validate records"). */
  detail: string;
  tier: ModelTier | null;
}

export interface VersionCard {
  id: string;
  version: number;
  status: WorkerVersionStatus;
  changeReason: VersionChangeReason;
  changeSummary: string | null;
  createdAt: string;
  activatedAt: string | null;
  retiredAt: string | null;
  locked: boolean;
  persona: { name: string; title: string; summary: string };
  steps: VersionCardStep[];
  tools: Array<{ toolName: string; displayName: string; requiresApproval: boolean }>;
  kpis: Array<{ id: string; name: string; target: string; direction: Kpi["direction"] }>;
  scheduleLabel: string;
  limits: RunLimits;
  costPerRunUsd: number;
  runsPerMonth: number;
  monthlyUsd: number;
  deliverable: { format: string; titleTemplate: string };
  runCount: number;
  score: number | null;
  trackRecord: { runs: number; successRate: number | null; acceptanceRate: number | null; avgCostPerRunUsd: number | null; avgJudgeScore: number | null } | null;
}

export interface EstimatedDeltasView {
  qualityPct: number | null;
  /** Always derived from the two blueprints' cost estimates when a base exists — the analysis's guess never contradicts the $ shown next to it. */
  costPct: number | null;
  latencyPct: number | null;
  /** "analysis" = quality/latency from the replacement plan; "estimate" = cost only, derived from the two cost estimates. */
  source: "analysis" | "estimate";
}

export interface ReplacePageView {
  worker: { id: string; name: string; title: string; avatarColor: string; status: WorkerStatus };
  target: VersionCard;
  base: VersionCard | null;
  changeReason: VersionChangeReason;
  canDecide: boolean;
  analysis: ReplacementAnalysis | null;
  diff: BlueprintDiffEntry[];
  deltas: EstimatedDeltasView | null;
  /** Any part of the proposal came from the simulator (analysis or mock model). */
  simulated: boolean;
  /** `canDecide` says the proposal is still open; this says the viewer is allowed to decide it. */
  permissions: WorkerPermissions;
}

function kpiTarget(k: Kpi): string {
  if (k.unit === "%") return `${Math.round(k.target * 100)}%`;
  if (k.unit === "$") return `$${k.target.toFixed(2)}`;
  return `${k.target} ${k.unit}`.trim();
}

function versionCard(summary: VersionSummary): VersionCard {
  const bp = summary.blueprint;
  const m = summary.metrics;
  return {
    id: summary.id,
    version: summary.version,
    status: summary.status,
    changeReason: summary.changeReason,
    changeSummary: summary.changeSummary,
    createdAt: summary.createdAt,
    activatedAt: summary.activatedAt,
    retiredAt: summary.retiredAt,
    locked: summary.locked,
    persona: { name: bp.persona.name, title: bp.persona.title, summary: bp.persona.summary },
    steps: bp.components.map((c) =>
      c.type === "agent"
        ? { id: c.id, name: c.name, kind: "agent", detail: `${c.modelTier} tier`, tier: c.modelTier }
        : { id: c.id, name: c.name, kind: "deterministic", detail: c.operation.replace(/_/g, " "), tier: null },
    ),
    tools: bp.tools.map((t) => ({ toolName: t.toolName, displayName: tools.get(t.toolName)?.displayName ?? t.toolName, requiresApproval: t.requiresApproval })),
    kpis: bp.kpis.map((k) => ({ id: k.id, name: k.name, target: kpiTarget(k), direction: k.direction })),
    scheduleLabel: describeCadence(bp.schedule),
    limits: bp.limits,
    costPerRunUsd: bp.costEstimate.perRunUsd,
    runsPerMonth: bp.costEstimate.runsPerMonth,
    monthlyUsd: bp.costEstimate.monthlyUsd,
    deliverable: { format: bp.deliverable.format, titleTemplate: bp.deliverable.titleTemplate },
    runCount: summary.runCount,
    score: summary.score.score,
    trackRecord: m ? { runs: m.runs, successRate: m.successRate, acceptanceRate: m.acceptanceRate, avgCostPerRunUsd: m.avgCostPerRunUsd, avgJudgeScore: m.avgJudgeScore } : null,
  };
}

function pctChange(before: number, after: number): number | null {
  if (!Number.isFinite(before) || before <= 0) return null;
  return ((after - before) / before) * 100;
}

/**
 * The compare page for `/workers/[workerId]/replace/[versionId]`. The worker id in the URL must own the version —
 * a mismatch is treated like a missing page rather than silently showing another worker's proposal.
 */
export async function getReplacePageData(
  organizationId: string,
  workerId: string,
  versionId: string,
  opts: { role?: UserRole } = {},
): Promise<ReplacePageView> {
  const comparison = await getVersionComparison(organizationId, versionId);
  if (comparison.worker.id !== workerId) throw notFound("Worker version");
  const worker = await db.worker.findFirst({ where: { id: workerId, organizationId }, select: { status: true } });
  if (!worker) throw notFound("Worker");

  const target = versionCard(comparison.target);
  const base = comparison.base ? versionCard(comparison.base) : null;
  const analysis = comparison.analysis;
  const estimatedCostPct = base ? pctChange(base.costPerRunUsd, target.costPerRunUsd) : null;
  const deltas: EstimatedDeltasView | null = analysis
    ? { ...analysis.estimatedDeltas, costPct: estimatedCostPct ?? analysis.estimatedDeltas.costPct, source: "analysis" }
    : base
      ? { qualityPct: null, costPct: estimatedCostPct, latencyPct: null, source: "estimate" }
      : null;

  return {
    worker: { ...comparison.worker, status: worker.status },
    target,
    base,
    changeReason: comparison.target.changeReason,
    canDecide: comparison.canDecide,
    analysis,
    diff: comparison.diff.entries,
    deltas,
    simulated: analysis?.simulated ?? false,
    permissions: permissionSubset(opts.role, WORKER_PERMISSION_KEYS),
  };
}
