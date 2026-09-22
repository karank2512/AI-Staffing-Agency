import { db } from "@/server/db";
import type { RunLimits } from "@/server/domain/blueprint";
import { clampRunLimits } from "@/server/security";
import { RunFailure } from "./failure";

/**
 * Run limits are checked against the truth, not the executor's memory: cost from Run.costUsd (written only by
 * usage.recordUsage), tool calls from ToolCall rows of the current attempt, and duration from the accumulated
 * active time — approval waits and retry backoff never count.
 *
 * The blueprint's own limits are clamped to the platform ceilings here as well as at design time (audit INF-04):
 * the runtime is the real enforcement point, whatever an older stored blueprint says.
 */

export interface LimitCheckArgs {
  runId: string;
  attempt: number;
  limits: RunLimits;
  activeMs: number;
  /** Tool calls about to be created (checked before their rows exist). */
  pendingToolCalls?: number;
}

const usd = (n: number) => `$${n.toFixed(2)}`;

export async function enforceLimits(args: LimitCheckArgs): Promise<void> {
  const limits = clampRunLimits(args.limits);
  const maxMs = limits.maxRunDurationSec * 1000;
  if (args.activeMs > maxMs) {
    throw new RunFailure(
      "LIMIT_EXCEEDED",
      `The run exceeded its ${limits.maxRunDurationSec}s time limit (${Math.round(args.activeMs / 1000)}s of active work)`,
      false,
    );
  }

  const run = await db.run.findUnique({ where: { id: args.runId }, select: { costUsd: true } });
  const spent = Number(run?.costUsd ?? 0);
  if (spent > limits.maxCostPerRunUsd) {
    throw new RunFailure("LIMIT_EXCEEDED", `The run exceeded its ${usd(limits.maxCostPerRunUsd)} cost limit (${usd(spent)} spent)`, false);
  }

  if (args.pendingToolCalls && args.pendingToolCalls > 0) {
    const used = await db.toolCall.count({ where: { runId: args.runId, attempt: args.attempt } });
    if (used + args.pendingToolCalls > limits.maxToolCallsPerRun) {
      throw new RunFailure(
        "LIMIT_EXCEEDED",
        `The run would exceed its limit of ${limits.maxToolCallsPerRun} tool call${limits.maxToolCallsPerRun === 1 ? "" : "s"} (${used} used, ${args.pendingToolCalls} more requested)`,
        false,
      );
    }
  }
}
