/**
 * Runtime public surface (contract: docs/CONTRACTS.md § runtime, types in ./types).
 *
 * A durable, DB-backed execution engine: `enqueueRun` puts work on the queue, the executor (or `executeRun`
 * inline) drives a run from its checkpoint through the blueprint's components, pausing for approvals and
 * surviving restarts. Everything here is org-scoped and every executor write to a Run is fenced by its lease.
 */

export { enqueueRun, claimNextRun, recoverStaleRuns, retryRun } from "./queue";
export { executeRun } from "./run";
export { transitionRun } from "./transitions";
export { cancelRun, cancelWorkerRuns } from "./cancel";
export { decideApproval } from "./approvals";
export { tickScheduler } from "./scheduler";
export { startExecutor, stopExecutor } from "./executor";

export * from "./types";
