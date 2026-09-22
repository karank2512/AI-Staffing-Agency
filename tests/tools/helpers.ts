import type { ApprovalStatus, ToolCallStatus } from "@prisma/client";
import { db, toJson } from "@/server/db";
import type { ToolContext } from "@/server/tools/types";
import type { createHiredWorker } from "../helpers/fixtures";

export type Hired = Awaited<ReturnType<typeof createHiredWorker>>;

/** A ToolContext for pure tool tests — simulated by default, no secrets. */
export function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    organizationId: "org_test",
    workerId: "worker_test",
    workerVersionId: "version_test",
    runId: "run_test",
    attempt: 1,
    simulated: true,
    getSecret: async () => undefined,
    ...overrides,
  };
}

export function ctxFor(organizationId: string, hired: Hired, runId: string, overrides: Partial<ToolContext> = {}): ToolContext {
  return makeCtx({
    organizationId,
    workerId: hired.worker.id,
    workerVersionId: hired.version.id,
    runId,
    ...overrides,
  });
}

export function createRun(organizationId: string, hired: Hired, data: { attempt?: number; status?: "RUNNING" | "WAITING_FOR_APPROVAL" } = {}) {
  return db.run.create({
    data: {
      organizationId,
      jobId: hired.job.id,
      workerId: hired.worker.id,
      workerVersionId: hired.version.id,
      status: data.status ?? "RUNNING",
      attempt: data.attempt ?? 1,
      startedAt: new Date(),
      simulated: true,
    },
  });
}

export function createToolCall(
  runId: string,
  hired: Hired,
  toolName: string,
  input: unknown,
  data: { status?: ToolCallStatus; attempt?: number } = {},
) {
  return db.toolCall.create({
    data: {
      runId,
      workerId: hired.worker.id,
      toolName,
      attempt: data.attempt ?? 1,
      input: toJson(input),
      status: data.status ?? "RUNNING",
      simulated: true,
    },
  });
}

export function createApproval(organizationId: string, runId: string, hired: Hired, toolCallId: string, toolName: string, status: ApprovalStatus) {
  return db.approval.create({
    data: {
      organizationId,
      runId,
      workerId: hired.worker.id,
      toolCallId,
      toolName,
      title: `Approval for ${toolName}`,
      payload: toJson({}),
      status,
      decidedAt: status === "PENDING" ? null : new Date(),
    },
  });
}

export const NOTIFICATION_INPUT = {
  channel: "email" as const,
  recipients: ["ops@acme.example", "cto@acme.example"],
  subject: "Weekly AI Infra Funding Report",
  body: "Here is this week's report. Twelve rounds, three over $50M.",
};
