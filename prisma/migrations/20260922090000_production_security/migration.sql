-- CreateEnum
CREATE TYPE "SecurityEventType" AS ENUM ('SIGN_UP', 'SIGN_IN_SUCCEEDED', 'SIGN_IN_FAILED', 'SIGN_IN_THROTTLED', 'ACCOUNT_LOCKED', 'SIGN_OUT', 'SESSIONS_REVOKED', 'PASSWORD_CHANGED', 'PASSWORD_REHASHED', 'CREDENTIAL_SET', 'CREDENTIAL_DELETED', 'INVITE_CREATED', 'INVITE_ACCEPTED', 'INVITE_REVOKED', 'ROLE_CHANGED', 'MEMBER_REMOVED', 'ORG_SETTINGS_CHANGED', 'RATE_LIMITED', 'BUDGET_EXCEEDED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxActiveWorkers" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "maxConcurrentRuns" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "maxQueuedRuns" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "monthlyBudgetUsd" DECIMAL(12,2),
ADD COLUMN     "suspendedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "disabledAt" TIMESTAMP(3),
ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "lastSignInAt" TIMESTAMP(3),
ADD COLUMN     "passwordChangedAt" TIMESTAMP(3),
ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "lockedUntil" TIMESTAMP(3),
    "lockCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SecurityEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "userId" TEXT,
    "type" "SecurityEventType" NOT NULL,
    "emailHash" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgSpendMonth" (
    "organizationId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "costUsd" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgSpendMonth_pkey" PRIMARY KEY ("organizationId","month")
);

-- CreateTable
CREATE TABLE "ExecutorHeartbeat" (
    "executorId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenAt" TIMESTAMP(3) NOT NULL,
    "inFlight" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ExecutorHeartbeat_pkey" PRIMARY KEY ("executorId")
);

-- CreateIndex
CREATE INDEX "RateLimitBucket_updatedAt_idx" ON "RateLimitBucket"("updatedAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_organizationId_createdAt_idx" ON "SecurityEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_userId_createdAt_idx" ON "SecurityEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_type_createdAt_idx" ON "SecurityEvent"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_organizationId_createdAt_idx" ON "Invitation"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Invitation_email_idx" ON "Invitation"("email");

-- CreateIndex
CREATE INDEX "ExecutorHeartbeat_seenAt_idx" ON "ExecutorHeartbeat"("seenAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_runId_idx" ON "ActivityEvent"("runId");

-- CreateIndex
CREATE INDEX "Deliverable_organizationId_status_idx" ON "Deliverable"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Deliverable_workerVersionId_idx" ON "Deliverable"("workerVersionId");

-- CreateIndex
CREATE INDEX "Evaluation_organizationId_createdAt_idx" ON "Evaluation"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ModelCall_runStepId_idx" ON "ModelCall"("runStepId");

-- CreateIndex
CREATE INDEX "Run_organizationId_status_idx" ON "Run"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Run_workerId_status_idx" ON "Run"("workerId", "status");

-- CreateIndex
CREATE INDEX "Run_jobId_createdAt_idx" ON "Run"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "ToolCall_workerId_createdAt_idx" ON "ToolCall"("workerId", "createdAt");

-- CreateIndex
CREATE INDEX "ToolCall_runStepId_idx" ON "ToolCall"("runStepId");

-- CreateIndex
CREATE INDEX "WorkerMessage_organizationId_idx" ON "WorkerMessage"("organizationId");

-- CreateIndex
CREATE INDEX "WorkerReview_organizationId_idx" ON "WorkerReview"("organizationId");

-- CreateIndex
CREATE INDEX "WorkerReview_workerVersionId_idx" ON "WorkerReview"("workerVersionId");

-- CreateIndex
CREATE INDEX "WorkerVersion_jobSpecId_idx" ON "WorkerVersion"("jobSpecId");

-- CreateIndex
CREATE INDEX "WorkerVersion_parentVersionId_idx" ON "WorkerVersion"("parentVersionId");

-- AddForeignKey
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgSpendMonth" ADD CONSTRAINT "OrgSpendMonth_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Partial index for the executor's claim query (only QUEUED rows are ever scanned).
CREATE INDEX IF NOT EXISTS "Run_queued_claim_idx" ON "Run" ("availableAt", "createdAt") WHERE "status" = 'QUEUED';

-- Mark the pre-existing seeded demo workspace so it is refused outside DEMO_MODE.
UPDATE "Organization" SET "isDemo" = true WHERE "slug" = 'acme-robotics';
