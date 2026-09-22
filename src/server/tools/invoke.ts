import type { z } from "zod";
import { db } from "@/server/db";
import { errorMessage } from "@/server/errors";
import { recordUsage } from "@/server/usage";
import { authorize } from "./authorize";
import { getTool } from "./registry";
import type { InvokeToolArgs, InvokeToolResult, ToolResult } from "./types";

/** Provider label on TOOL usage rows (`UsageRecord.provider`). */
export const TOOL_USAGE_PROVIDER = "tool";

function formatIssues(error: z.ZodError): string {
  const lines = error.issues.slice(0, 5).map((issue) => {
    const path = issue.path.map(String).join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  return `Invalid input — ${lines.join("; ")}`;
}

/**
 * The single execution path for every tool call (the model → runtime → here). Order per contract:
 * registry lookup → Zod validation → authorize → approval check by toolCallId → execute → TOOL usage record.
 *
 * NEVER throws and NEVER writes anything but a UsageRecord: ToolCall / RunStep / Approval rows belong to the
 * runtime, which maps our status onto them.
 */
export async function invoke(args: InvokeToolArgs): Promise<InvokeToolResult> {
  const startedAt = Date.now();
  const latency = () => Date.now() - startedAt;
  const { ctx } = args;
  try {
    const tool = getTool(args.toolName);
    if (!tool) return { status: "denied", reason: "unknown_tool", message: `There is no tool named "${args.toolName}"` };

    const parsed = tool.inputSchema.safeParse(args.input);
    if (!parsed.success) return { status: "invalid_input", message: formatIssues(parsed.error) };

    const auth = await authorize({
      workerId: ctx.workerId,
      workerVersionId: ctx.workerVersionId,
      toolName: tool.name,
      runId: ctx.runId,
      attempt: ctx.attempt,
      organizationId: ctx.organizationId,
    });
    if (!auth.allowed) return { status: "denied", reason: auth.reason, message: auth.message };

    if (auth.requiresApproval) {
      const approval = await db.approval.findFirst({
        where: { toolCallId: args.toolCallId, organizationId: ctx.organizationId, toolName: tool.name },
        select: { status: true },
      });
      if (!approval || approval.status === "PENDING") return { status: "approval_required", grantId: auth.grantId };
      if (approval.status === "REJECTED") return { status: "rejected", message: `A reviewer declined this request to use ${tool.displayName}` };
      if (approval.status === "EXPIRED") return { status: "rejected", message: `The approval request for ${tool.displayName} expired before it was decided` };
    }

    let result: ToolResult;
    try {
      result = await tool.execute(parsed.data, ctx);
    } catch (e) {
      return { status: "error", message: errorMessage(e), latencyMs: latency() };
    }

    const reported = typeof result.costUsd === "number" && Number.isFinite(result.costUsd) && result.costUsd > 0 ? result.costUsd : 0;
    const costUsd = tool.costPerCallUsd + reported;
    await recordUsage({
      organizationId: ctx.organizationId,
      kind: "TOOL",
      provider: TOOL_USAGE_PROVIDER,
      resource: tool.name,
      costUsd,
      simulated: result.simulated,
      workerId: ctx.workerId,
      runId: ctx.runId,
    });
    return { status: "ok", output: result.output, simulated: result.simulated, costUsd, latencyMs: latency() };
  } catch (e) {
    return { status: "error", message: errorMessage(e), latencyMs: latency() };
  }
}
