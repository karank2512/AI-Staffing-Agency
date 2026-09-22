-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('DRAFT', 'SPEC_APPROVED', 'STAFFED', 'PAUSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "JobSpecStatus" AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "WorkerStatus" AS ENUM ('ACTIVE', 'PAUSED', 'RETIRED');

-- CreateEnum
CREATE TYPE "WorkerHealth" AS ENUM ('UNKNOWN', 'HEALTHY', 'NEEDS_ATTENTION');

-- CreateEnum
CREATE TYPE "WorkerVersionStatus" AS ENUM ('PROPOSED', 'ACTIVE', 'REPLACED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VersionChangeReason" AS ENUM ('INITIAL_HIRE', 'REPLACEMENT', 'SPEC_CHANGE', 'MANUAL');

-- CreateEnum
CREATE TYPE "ScheduleKind" AS ENUM ('MANUAL', 'HOURLY', 'DAILY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'RUNNING', 'WAITING_FOR_APPROVAL', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RunTrigger" AS ENUM ('MANUAL', 'SCHEDULED', 'RETRY', 'CHAT', 'HIRE');

-- CreateEnum
CREATE TYPE "RunStepKind" AS ENUM ('PLAN', 'MODEL_CALL', 'TOOL_CALL', 'DETERMINISTIC', 'APPROVAL', 'DELIVERABLE', 'EVALUATION', 'NOTE', 'ERROR');

-- CreateEnum
CREATE TYPE "RunStepStatus" AS ENUM ('PENDING', 'RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ToolCallStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DENIED');

-- CreateEnum
CREATE TYPE "DeliverableFormat" AS ENUM ('MARKDOWN', 'CSV', 'JSON');

-- CreateEnum
CREATE TYPE "DeliverableStatus" AS ENUM ('PENDING_REVIEW', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "EvaluationType" AS ENUM ('DETERMINISTIC', 'LLM_JUDGE', 'USER_FEEDBACK');

-- CreateEnum
CREATE TYPE "ReviewRecommendation" AS ENUM ('KEEP', 'IMPROVE', 'REPLACE');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'WORKER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MessageClassification" AS ENUM ('QUESTION', 'TEMPORARY_INSTRUCTION', 'SPEC_CHANGE');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('WORKER', 'USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('JOB_CREATED', 'JOB_SPEC_APPROVED', 'WORKER_HIRED', 'WORKER_PAUSED', 'WORKER_RESUMED', 'WORKER_RETIRED', 'WORKER_REPLACED', 'VERSION_PROPOSED', 'VERSION_REJECTED', 'RUN_QUEUED', 'RUN_STARTED', 'RUN_SUCCEEDED', 'RUN_FAILED', 'RUN_CANCELLED', 'TOOL_USED', 'APPROVAL_REQUESTED', 'APPROVAL_APPROVED', 'APPROVAL_REJECTED', 'DELIVERABLE_CREATED', 'DELIVERABLE_ACCEPTED', 'DELIVERABLE_REJECTED', 'EVALUATION_COMPLETED', 'REVIEW_GENERATED', 'INSTRUCTION_RECEIVED', 'PERMISSION_CHANGED', 'NOTE');

-- CreateEnum
CREATE TYPE "UsageKind" AS ENUM ('MODEL', 'TOOL');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "jobFamily" TEXT NOT NULL DEFAULT 'general',
    "status" "JobStatus" NOT NULL DEFAULT 'DRAFT',
    "intake" JSONB,
    "pendingProposal" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobSpec" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "JobSpecStatus" NOT NULL DEFAULT 'DRAFT',
    "spec" JSONB NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobSpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Worker" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "avatarColor" TEXT NOT NULL DEFAULT 'violet',
    "status" "WorkerStatus" NOT NULL DEFAULT 'ACTIVE',
    "health" "WorkerHealth" NOT NULL DEFAULT 'UNKNOWN',
    "healthReason" TEXT,
    "score" DOUBLE PRECISION,
    "scoreUpdatedAt" TIMESTAMP(3),
    "scheduleKind" "ScheduleKind" NOT NULL DEFAULT 'MANUAL',
    "scheduleHour" INTEGER,
    "scheduleDow" INTEGER,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "currentVersionId" TEXT,
    "hiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Worker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerVersion" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "jobSpecId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "WorkerVersionStatus" NOT NULL DEFAULT 'PROPOSED',
    "blueprint" JSONB NOT NULL,
    "changeReason" "VersionChangeReason" NOT NULL DEFAULT 'INITIAL_HIRE',
    "changeSummary" TEXT,
    "analysis" JSONB,
    "parentVersionId" TEXT,
    "lockedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerToolGrant" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "WorkerToolGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "workerVersionId" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "trigger" "RunTrigger" NOT NULL DEFAULT 'MANUAL',
    "input" JSONB,
    "output" JSONB,
    "checkpoint" JSONB,
    "error" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "maxAttempts" INTEGER NOT NULL DEFAULT 2,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "requestedById" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunStep" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "componentId" TEXT,
    "kind" "RunStepKind" NOT NULL,
    "status" "RunStepStatus" NOT NULL DEFAULT 'RUNNING',
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "input" JSONB,
    "output" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "RunStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelCall" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workerId" TEXT,
    "jobId" TEXT,
    "runId" TEXT,
    "runStepId" TEXT,
    "purpose" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "request" JSONB,
    "response" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolCall" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "runStepId" TEXT,
    "workerId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "callId" TEXT,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "status" "ToolCallStatus" NOT NULL DEFAULT 'RUNNING',
    "error" TEXT,
    "latencyMs" INTEGER,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deliverable" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "workerVersionId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "format" "DeliverableFormat" NOT NULL DEFAULT 'MARKDOWN',
    "content" TEXT NOT NULL,
    "data" JSONB,
    "status" "DeliverableStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "feedback" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deliverable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evaluation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "workerVersionId" TEXT NOT NULL,
    "runId" TEXT,
    "deliverableId" TEXT,
    "type" "EvaluationType" NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "summary" TEXT,
    "details" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerReview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "workerVersionId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "summary" TEXT NOT NULL,
    "strengths" JSONB NOT NULL,
    "problems" JSONB NOT NULL,
    "recommendation" "ReviewRecommendation" NOT NULL,
    "recommendationDetail" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "toolCallId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "payload" JSONB NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "classification" "MessageClassification",
    "instructionActive" BOOLEAN NOT NULL DEFAULT false,
    "appliedToRunId" TEXT,
    "proposedVersionId" TEXT,
    "userId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workerId" TEXT,
    "jobId" TEXT,
    "runId" TEXT,
    "type" "ActivityType" NOT NULL,
    "actorType" "ActorType" NOT NULL DEFAULT 'SYSTEM',
    "actorName" TEXT,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workerId" TEXT,
    "jobId" TEXT,
    "runId" TEXT,
    "kind" "UsageKind" NOT NULL,
    "provider" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "billableUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Credential" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT,
    "encryptedValue" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "Credential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE INDEX "Job_organizationId_status_idx" ON "Job"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Job_organizationId_createdAt_idx" ON "Job"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobSpec_jobId_version_key" ON "JobSpec"("jobId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Worker_currentVersionId_key" ON "Worker"("currentVersionId");

-- CreateIndex
CREATE INDEX "Worker_organizationId_status_idx" ON "Worker"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Worker_jobId_idx" ON "Worker"("jobId");

-- CreateIndex
CREATE INDEX "Worker_status_nextRunAt_idx" ON "Worker"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "WorkerVersion_workerId_status_idx" ON "WorkerVersion"("workerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerVersion_workerId_version_key" ON "WorkerVersion"("workerId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerToolGrant_workerId_toolName_key" ON "WorkerToolGrant"("workerId", "toolName");

-- CreateIndex
CREATE INDEX "Run_status_availableAt_idx" ON "Run"("status", "availableAt");

-- CreateIndex
CREATE INDEX "Run_organizationId_createdAt_idx" ON "Run"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Run_workerId_createdAt_idx" ON "Run"("workerId", "createdAt");

-- CreateIndex
CREATE INDEX "Run_workerVersionId_idx" ON "Run"("workerVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "RunStep_runId_index_key" ON "RunStep"("runId", "index");

-- CreateIndex
CREATE INDEX "ModelCall_runId_idx" ON "ModelCall"("runId");

-- CreateIndex
CREATE INDEX "ModelCall_organizationId_createdAt_idx" ON "ModelCall"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ToolCall_runId_idx" ON "ToolCall"("runId");

-- CreateIndex
CREATE INDEX "ToolCall_workerId_toolName_idx" ON "ToolCall"("workerId", "toolName");

-- CreateIndex
CREATE INDEX "Deliverable_organizationId_createdAt_idx" ON "Deliverable"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Deliverable_workerId_createdAt_idx" ON "Deliverable"("workerId", "createdAt");

-- CreateIndex
CREATE INDEX "Deliverable_runId_idx" ON "Deliverable"("runId");

-- CreateIndex
CREATE INDEX "Evaluation_workerId_createdAt_idx" ON "Evaluation"("workerId", "createdAt");

-- CreateIndex
CREATE INDEX "Evaluation_workerVersionId_type_idx" ON "Evaluation"("workerVersionId", "type");

-- CreateIndex
CREATE INDEX "Evaluation_runId_idx" ON "Evaluation"("runId");

-- CreateIndex
CREATE INDEX "WorkerReview_workerId_createdAt_idx" ON "WorkerReview"("workerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Approval_toolCallId_key" ON "Approval"("toolCallId");

-- CreateIndex
CREATE INDEX "Approval_organizationId_status_idx" ON "Approval"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Approval_runId_idx" ON "Approval"("runId");

-- CreateIndex
CREATE INDEX "WorkerMessage_workerId_createdAt_idx" ON "WorkerMessage"("workerId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkerMessage_workerId_classification_instructionActive_idx" ON "WorkerMessage"("workerId", "classification", "instructionActive");

-- CreateIndex
CREATE INDEX "ActivityEvent_organizationId_createdAt_idx" ON "ActivityEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_workerId_createdAt_idx" ON "ActivityEvent"("workerId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageRecord_organizationId_occurredAt_idx" ON "UsageRecord"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "UsageRecord_workerId_occurredAt_idx" ON "UsageRecord"("workerId", "occurredAt");

-- CreateIndex
CREATE INDEX "UsageRecord_runId_idx" ON "UsageRecord"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "Credential_organizationId_name_key" ON "Credential"("organizationId", "name");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobSpec" ADD CONSTRAINT "JobSpec_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Worker" ADD CONSTRAINT "Worker_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Worker" ADD CONSTRAINT "Worker_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Worker" ADD CONSTRAINT "Worker_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "WorkerVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerVersion" ADD CONSTRAINT "WorkerVersion_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerVersion" ADD CONSTRAINT "WorkerVersion_jobSpecId_fkey" FOREIGN KEY ("jobSpecId") REFERENCES "JobSpec"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerVersion" ADD CONSTRAINT "WorkerVersion_parentVersionId_fkey" FOREIGN KEY ("parentVersionId") REFERENCES "WorkerVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerToolGrant" ADD CONSTRAINT "WorkerToolGrant_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_workerVersionId_fkey" FOREIGN KEY ("workerVersionId") REFERENCES "WorkerVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunStep" ADD CONSTRAINT "RunStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelCall" ADD CONSTRAINT "ModelCall_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelCall" ADD CONSTRAINT "ModelCall_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelCall" ADD CONSTRAINT "ModelCall_runStepId_fkey" FOREIGN KEY ("runStepId") REFERENCES "RunStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolCall" ADD CONSTRAINT "ToolCall_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolCall" ADD CONSTRAINT "ToolCall_runStepId_fkey" FOREIGN KEY ("runStepId") REFERENCES "RunStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deliverable" ADD CONSTRAINT "Deliverable_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deliverable" ADD CONSTRAINT "Deliverable_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deliverable" ADD CONSTRAINT "Deliverable_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deliverable" ADD CONSTRAINT "Deliverable_workerVersionId_fkey" FOREIGN KEY ("workerVersionId") REFERENCES "WorkerVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deliverable" ADD CONSTRAINT "Deliverable_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_workerVersionId_fkey" FOREIGN KEY ("workerVersionId") REFERENCES "WorkerVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "Deliverable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerReview" ADD CONSTRAINT "WorkerReview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerReview" ADD CONSTRAINT "WorkerReview_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerReview" ADD CONSTRAINT "WorkerReview_workerVersionId_fkey" FOREIGN KEY ("workerVersionId") REFERENCES "WorkerVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_toolCallId_fkey" FOREIGN KEY ("toolCallId") REFERENCES "ToolCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerMessage" ADD CONSTRAINT "WorkerMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerMessage" ADD CONSTRAINT "WorkerMessage_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

