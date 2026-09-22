import type { ApprovalStatus, Prisma, RunStatus } from "@prisma/client";
import { db } from "@/server/db";
import { tools } from "@/server/tools";

/**
 * Read side of /approvals (and the "Needs your attention" strip on /workforce). Plain view models only —
 * decisions go through `runtime.decideApproval` from the route's actions.ts.
 */

export interface ApprovalView {
  id: string;
  status: ApprovalStatus;
  /** "Maya wants to send the weekly report to 3 stakeholders" */
  title: string;
  description: string | null;
  toolName: string;
  /** Registry display name ("Notifications"); falls back to the raw tool name for unknown tools. */
  toolLabel: string;
  /** The exact tool input the human is approving. */
  payload: unknown;
  runId: string;
  runStatus: RunStatus;
  /** True when the run was produced in Simulated mode (the action itself would be a simulated outbox send). */
  simulated: boolean;
  worker: { id: string; name: string; title: string; avatarColor: string };
  jobTitle: string;
  /** ISO */
  requestedAt: string;
  /** ISO, null while pending */
  decidedAt: string | null;
  /** Display name of the person who decided; null while pending or when the runtime expired it. */
  decidedBy: string | null;
  note: string | null;
}

export interface ListApprovalsOptions {
  status?: ApprovalStatus;
  workerId?: string;
  /** Default 100. */
  limit?: number;
}

const APPROVAL_SELECT = {
  id: true,
  status: true,
  title: true,
  description: true,
  toolName: true,
  payload: true,
  runId: true,
  workerId: true,
  decidedById: true,
  decidedAt: true,
  decisionNote: true,
  createdAt: true,
  run: { select: { status: true, simulated: true, job: { select: { title: true } } } },
  worker: { select: { id: true, name: true, title: true, avatarColor: true } },
} satisfies Prisma.ApprovalSelect;

type ApprovalRow = Prisma.ApprovalGetPayload<{ select: typeof APPROVAL_SELECT }>;

function toolLabelFor(toolName: string): string {
  return tools.get(toolName)?.displayName ?? toolName;
}

function toView(row: ApprovalRow, userNames: Map<string, string>): ApprovalView {
  return {
    id: row.id,
    status: row.status,
    title: row.title,
    description: row.description,
    toolName: row.toolName,
    toolLabel: toolLabelFor(row.toolName),
    payload: row.payload,
    runId: row.runId,
    runStatus: row.run.status,
    simulated: row.run.simulated,
    worker: row.worker,
    jobTitle: row.run.job.title,
    requestedAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decidedBy: row.decidedById ? (userNames.get(row.decidedById) ?? null) : null,
    note: row.decisionNote,
  };
}

/** Resolve decider ids to names in one query; a deleted user simply shows no name. */
async function userNamesFor(organizationId: string, rows: ApprovalRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((r) => r.decidedById).filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Map();
  const users = await db.user.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

/**
 * Approvals of the org, newest first. `status: "PENDING"` additionally requires the run to still be
 * WAITING_FOR_APPROVAL — a PENDING row whose run was cancelled or failed is about to be expired by the
 * runtime and must not be offered for a decision (same rule as the sidebar badge).
 */
export async function listApprovals(organizationId: string, opts: ListApprovalsOptions = {}): Promise<ApprovalView[]> {
  const where: Prisma.ApprovalWhereInput = { organizationId };
  if (opts.status) where.status = opts.status;
  if (opts.status === "PENDING") where.run = { status: "WAITING_FOR_APPROVAL" };
  if (opts.workerId) where.workerId = opts.workerId;

  const rows = await db.approval.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(200, Math.max(1, opts.limit ?? 100)),
    select: APPROVAL_SELECT,
  });
  const names = await userNamesFor(organizationId, rows);
  return rows.map((row) => toView(row, names));
}

export interface ApprovalsPage {
  /** Actionable right now, oldest first so the longest-waiting request is on top. */
  pending: ApprovalView[];
  /** APPROVED / REJECTED / EXPIRED, newest decision first. */
  decided: ApprovalView[];
}

export async function getApprovalsPage(organizationId: string, opts: { workerId?: string } = {}): Promise<ApprovalsPage> {
  const [pending, decided] = await Promise.all([
    listApprovals(organizationId, { status: "PENDING", workerId: opts.workerId }),
    db.approval.findMany({
      where: { organizationId, status: { not: "PENDING" }, ...(opts.workerId ? { workerId: opts.workerId } : {}) },
      orderBy: [{ decidedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 50,
      select: APPROVAL_SELECT,
    }),
  ]);
  const names = await userNamesFor(organizationId, decided);
  return {
    pending: [...pending].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt)),
    decided: decided.map((row) => toView(row, names)),
  };
}

/** The run and worker an approval belongs to (org-scoped), so actions can revalidate those pages precisely. */
export async function getApprovalRefs(
  organizationId: string,
  approvalId: string,
): Promise<{ runId: string; workerId: string; workerName: string } | null> {
  const row = await db.approval.findFirst({
    where: { id: approvalId, organizationId },
    select: { runId: true, workerId: true, worker: { select: { name: true } } },
  });
  return row ? { runId: row.runId, workerId: row.workerId, workerName: row.worker.name } : null;
}
