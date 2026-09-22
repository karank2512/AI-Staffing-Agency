import { db } from "@/server/db";
import { getTool } from "./registry";
import type { AuthorizationResult } from "./types";

export interface AuthorizeArgs {
  workerId: string;
  workerVersionId: string;
  toolName: string;
  runId?: string;
  attempt?: number;
  /** When known (invoke always passes it) the version lookup is additionally scoped to the organization. */
  organizationId?: string;
}

/** ToolCall statuses that count against `maxCallsPerRun` — pending/denied calls never executed. */
const COUNTED_STATUSES = ["RUNNING", "SUCCEEDED", "FAILED"] as const;

/** Lenient read of blueprint.tools — an Array of { toolName } — without requiring a full blueprint parse. */
function blueprintListsTool(blueprint: unknown, toolName: string): boolean {
  const tools = (blueprint as { tools?: unknown } | null)?.tools;
  if (!Array.isArray(tools)) return false;
  return tools.some((t) => !!t && typeof t === "object" && (t as { toolName?: unknown }).toolName === toolName);
}

function maxCallsPerRun(config: unknown): number | undefined {
  const value = (config as { maxCallsPerRun?: unknown } | null)?.maxCallsPerRun;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

/**
 * The permission check behind every tool call, in contract order: registry → blueprint → grant → revocation →
 * per-run call limit. Pure read; the caller decides what to do with the verdict.
 */
export async function authorize(args: AuthorizeArgs): Promise<AuthorizationResult> {
  const { workerId, workerVersionId, toolName, runId, organizationId } = args;

  const tool = getTool(toolName);
  if (!tool) return { allowed: false, reason: "unknown_tool", message: `There is no tool named "${toolName}"` };

  const version = await db.workerVersion.findFirst({
    where: { id: workerVersionId, workerId, ...(organizationId ? { worker: { organizationId } } : {}) },
    select: { blueprint: true },
  });
  if (!version) {
    return { allowed: false, reason: "not_in_blueprint", message: `${tool.displayName} is not part of this worker's current design (version not found)` };
  }
  if (!blueprintListsTool(version.blueprint, tool.name)) {
    return { allowed: false, reason: "not_in_blueprint", message: `${tool.displayName} is not part of this worker's design` };
  }

  const grant = await db.workerToolGrant.findUnique({
    where: { workerId_toolName: { workerId, toolName: tool.name } },
    select: { id: true, requiresApproval: true, revokedAt: true, config: true },
  });
  if (!grant) return { allowed: false, reason: "no_grant", message: `This worker has not been granted access to ${tool.displayName}` };
  if (grant.revokedAt) return { allowed: false, reason: "grant_revoked", message: `Access to ${tool.displayName} was revoked for this worker` };

  const max = maxCallsPerRun(grant.config);
  if (max !== undefined && runId) {
    // The runtime creates the current ToolCall row BEFORE invoking, so it is part of the count — hence `>`.
    const attempt = args.attempt ?? (await db.run.findUnique({ where: { id: runId }, select: { attempt: true } }))?.attempt;
    const count = await db.toolCall.count({
      where: { runId, workerId, toolName: tool.name, status: { in: [...COUNTED_STATUSES] }, ...(attempt !== undefined ? { attempt } : {}) },
    });
    if (count > max) {
      return { allowed: false, reason: "call_limit", message: `${tool.displayName} may be used at most ${max} time${max === 1 ? "" : "s"} per run` };
    }
  }

  return { allowed: true, requiresApproval: grant.requiresApproval, grantId: grant.id };
}
