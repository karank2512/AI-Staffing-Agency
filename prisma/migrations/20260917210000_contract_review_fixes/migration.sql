-- DropForeignKey
ALTER TABLE "Deliverable" DROP CONSTRAINT "Deliverable_workerVersionId_fkey";

-- DropForeignKey
ALTER TABLE "Evaluation" DROP CONSTRAINT "Evaluation_workerVersionId_fkey";

-- DropForeignKey
ALTER TABLE "Run" DROP CONSTRAINT "Run_workerVersionId_fkey";

-- DropForeignKey
ALTER TABLE "WorkerReview" DROP CONSTRAINT "WorkerReview_workerVersionId_fkey";

-- DropForeignKey
ALTER TABLE "WorkerVersion" DROP CONSTRAINT "WorkerVersion_jobSpecId_fkey";

-- AlterTable
ALTER TABLE "RunStep" ADD COLUMN     "attempt" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "ToolCall" ADD COLUMN     "attempt" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "ActivityEvent_jobId_createdAt_idx" ON "ActivityEvent"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "Approval_workerId_status_idx" ON "Approval"("workerId", "status");

-- CreateIndex
CREATE INDEX "Deliverable_jobId_createdAt_idx" ON "Deliverable"("jobId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Evaluation_deliverableId_type_key" ON "Evaluation"("deliverableId", "type");

-- CreateIndex
CREATE INDEX "ModelCall_workerId_createdAt_idx" ON "ModelCall"("workerId", "createdAt");

-- AddForeignKey
ALTER TABLE "WorkerVersion" ADD CONSTRAINT "WorkerVersion_jobSpecId_fkey" FOREIGN KEY ("jobSpecId") REFERENCES "JobSpec"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_workerVersionId_fkey" FOREIGN KEY ("workerVersionId") REFERENCES "WorkerVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deliverable" ADD CONSTRAINT "Deliverable_workerVersionId_fkey" FOREIGN KEY ("workerVersionId") REFERENCES "WorkerVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_workerVersionId_fkey" FOREIGN KEY ("workerVersionId") REFERENCES "WorkerVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerReview" ADD CONSTRAINT "WorkerReview_workerVersionId_fkey" FOREIGN KEY ("workerVersionId") REFERENCES "WorkerVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

