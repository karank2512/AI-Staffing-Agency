import type { ActivityType, ActorType, PrismaClient } from "@prisma/client";
import { toJson } from "@/server/db";
import { cadenceToWorkerFields, describeCadence, type FollowUpQuestion, type IntakeAnswers, type JobSpec } from "@/server/domain";
import { oneLine } from "@/server/runtime";
import { tools } from "@/server/tools";
import type { DesignedWorker } from "./blueprints";
import type { Seat } from "./trace";

/**
 * A staffed job as the hire flow leaves it: Job (STAFFED) with its intake Q&A, the APPROVED JobSpec v1, the Worker
 * with its schedule, WorkerVersion v1 (ACTIVE, INITIAL_HIRE, rationale as change summary), tool grants, and the
 * JOB_CREATED → JOB_SPEC_APPROVED → WORKER_HIRED feed with staffing's own wording.
 */

export interface ActivityAt {
  organizationId: string;
  type: ActivityType;
  title: string;
  detail?: string;
  workerId?: string;
  jobId?: string;
  runId?: string;
  actorType: ActorType;
  actorName?: string;
  metadata?: Record<string, unknown>;
  at: Date;
}

export async function activityAt(db: PrismaClient, e: ActivityAt): Promise<void> {
  await db.activityEvent.create({
    data: {
      organizationId: e.organizationId,
      workerId: e.workerId ?? null,
      jobId: e.jobId ?? null,
      runId: e.runId ?? null,
      type: e.type,
      actorType: e.actorType,
      actorName: e.actorName ?? null,
      title: oneLine(e.title),
      detail: e.detail ?? null,
      metadata: e.metadata === undefined ? undefined : toJson(e.metadata),
      createdAt: e.at,
    },
  });
}

export interface StaffArgs {
  organizationId: string;
  user: { id: string; name: string };
  ids: { jobId: string; workerId: string };
  spec: JobSpec;
  designed: DesignedWorker;
  /** What the customer typed at intake. */
  description: string;
  intake: { questions: FollowUpQuestion[]; answers: Record<string, string> };
  jobCreatedAt: Date;
  specApprovedAt: Date;
  hiredAt: Date;
}

const grantRequiresApproval = (toolName: string, fromBlueprint: boolean) => fromBlueprint || (tools.get(toolName)?.defaultRequiresApproval ?? false);

export async function staffJob(db: PrismaClient, a: StaffArgs): Promise<Seat> {
  const { spec, designed, organizationId, user } = a;
  const { blueprint } = designed;
  const intake: IntakeAnswers = { questions: a.intake.questions, answers: a.intake.answers };

  await db.job.create({
    data: {
      id: a.ids.jobId,
      organizationId,
      title: spec.title,
      description: a.description,
      jobFamily: spec.jobFamily,
      status: "STAFFED",
      intake: toJson(intake),
      createdById: user.id,
      createdAt: a.jobCreatedAt,
      updatedAt: a.hiredAt,
    },
  });
  const specRow = await db.jobSpec.create({
    data: { jobId: a.ids.jobId, version: 1, status: "APPROVED", spec: toJson(spec), approvedAt: a.specApprovedAt, createdAt: new Date(a.jobCreatedAt.getTime() + 95_000) },
    select: { id: true },
  });
  await db.worker.create({
    data: {
      id: a.ids.workerId,
      organizationId,
      jobId: a.ids.jobId,
      name: blueprint.persona.name,
      title: blueprint.persona.title,
      avatarColor: blueprint.persona.avatarColor,
      status: "ACTIVE",
      health: "UNKNOWN",
      ...cadenceToWorkerFields(blueprint.schedule),
      // Unscheduled while the history is written: a live scheduler (dev server) must not fire into a half-built
      // org. seedDemo sets the real next slot at the end.
      nextRunAt: null,
      hiredAt: a.hiredAt,
      createdAt: a.hiredAt,
      updatedAt: a.hiredAt,
    },
  });
  const version = await db.workerVersion.create({
    data: {
      workerId: a.ids.workerId,
      jobSpecId: specRow.id,
      version: 1,
      status: "ACTIVE",
      blueprint: toJson(blueprint),
      changeReason: "INITIAL_HIRE",
      changeSummary: designed.rationale.join("\n") || null,
      activatedAt: a.hiredAt,
      createdById: user.id,
      createdAt: a.hiredAt,
    },
    select: { id: true },
  });
  await db.worker.update({ where: { id: a.ids.workerId }, data: { currentVersionId: version.id, updatedAt: a.hiredAt } });
  await db.workerToolGrant.createMany({
    data: blueprint.tools.map((t) => ({
      workerId: a.ids.workerId,
      toolName: t.toolName,
      requiresApproval: grantRequiresApproval(t.toolName, t.requiresApproval),
      grantedById: user.id,
      createdAt: a.hiredAt,
      updatedAt: a.hiredAt,
    })),
  });

  const questions = intake.questions.length;
  await activityAt(db, {
    organizationId,
    type: "JOB_CREATED",
    title: `${user.name} opened a job: “${spec.title}”`,
    detail: questions > 0 ? `${questions} follow-up question${questions === 1 ? "" : "s"} to answer before the spec is drafted` : "No follow-up questions needed",
    jobId: a.ids.jobId,
    actorType: "USER",
    actorName: user.name,
    at: a.jobCreatedAt,
  });
  await activityAt(db, {
    organizationId,
    type: "JOB_SPEC_APPROVED",
    title: `${user.name} approved the spec for “${spec.title}”`,
    detail: `Version 1 · ${spec.deliverable.title} (${spec.deliverable.format})`,
    jobId: a.ids.jobId,
    actorType: "USER",
    actorName: user.name,
    metadata: { jobSpecId: specRow.id, version: 1 },
    at: a.specApprovedAt,
  });
  await activityAt(db, {
    organizationId,
    type: "WORKER_HIRED",
    title: `You hired ${blueprint.persona.name} as ${blueprint.persona.title}`,
    detail: `${spec.title} · ${describeCadence(blueprint.schedule)} · est. $${blueprint.costEstimate.perRunUsd.toFixed(2)} per run`,
    workerId: a.ids.workerId,
    jobId: a.ids.jobId,
    actorType: "USER",
    actorName: user.name,
    metadata: { version: 1, changeReason: "INITIAL_HIRE" },
    at: a.hiredAt,
  });

  return {
    organizationId,
    userId: user.id,
    userName: user.name,
    workerId: a.ids.workerId,
    workerName: blueprint.persona.name,
    jobId: a.ids.jobId,
    jobTitle: spec.title,
    versionId: version.id,
    blueprint,
    spec,
  };
}

/** Follow-up questions exactly as the scoper words them for these families (answers are the customer's). */
export const q = (id: string, question: string, why: string, suggestions: string[]): FollowUpQuestion => ({ id, question, why, suggestions });

export const RECIPIENTS_QUESTION = q(
  "recipients",
  "Who should receive the deliverable, and how?",
  "If it should go to someone by email or Slack, the worker gets a notification tool that always waits for your approval.",
  ["Just me, in the workspace", "Email it to leadership@company.com", "Post it in Slack #market-intel"],
);
