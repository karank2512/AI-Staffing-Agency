# Testing Strategy

Vitest against a dedicated `ai_staffing_agency_test` database (same migrations), simulated model/tool mode, per-test isolated orgs via factories. No global truncation, no assertions on global table counts (suites may run in parallel).

## 1. Harness

- `tests/setup/global.ts`: ensures test DB exists + migrated, forces simulated mode env.
- `tests/helpers/factory.ts`: `createTestOrg()` → `{ organization, user, session, cleanup }`; unique per test; `cleanup()` deletes the org subtree.
- `tests/helpers/fixtures.ts`: `makeJobSpec(overrides)`, `makeBlueprint(overrides)` (schema-valid builders), `createHiredWorker(orgId, overrides)` (job+spec+worker+version+grants persisted).
- Engine functions called directly (`executeRun(runId)`), never via background loops; `claimNextRun`/`tickScheduler`/`recoverStaleRuns` always called with the test `organizationId`.
- `persist: false` CallTracking only in pure unit tests of the models module.

## 2. Coverage map

### Domain (unit)
- JobSpecSchema: valid fixtures parse; missing objective/tasks, bad schedule kind, unknown capabilities rejected; `parseJobSpec` wraps errors in `AppError("INVALID_SPEC")`.
- WorkerBlueprintSchema: strategy/component discrimination, budget bounds, tool-name presence; `parseBlueprint` rejects unregistered code ops.
- Run state machine: full transition matrix — every legal transition passes, every illegal transition (e.g. `completed → running`) throws.
- Schedule math: `nextScheduledAt` for daily/weekdays/weekly incl. weekend skip.

### Staffing (integration, simulated LLM)
- `scopeJob` returns schema-valid spec; determinism (same input → same spec).
- `designWorker`: tools only from registry; deterministic steps present for dedupe/CSV; tiers assigned per selection rules; KPIs derived from success metrics.
- `estimateCost`: hand-computed expectation for a known blueprint (pricing table math), per-deliverable division.

### Runtime (integration)
- enqueue → claim → execute happy path: run completes, steps ordered/completed, ModelCalls+ToolCalls persisted with costs, deliverable exists, activity humanized.
- Version locking: first enqueue sets `lockedAt`; mutation attempt on locked version throws.
- Approval gate: approval-required tool pauses run (`waiting_approval`, Approval pending); approve → resume → completes; reject → run failed with structured error; completed steps not re-executed on resume.
- Retries: injected transient tool failure retries then succeeds (attempts recorded); terminal failure fails run with `errorJson.stepKey`.
- Budgets: max-model-calls cap aborts with labeled failure.
- Recovery: stale heartbeat run re-queued by `recoverStaleRuns(orgId)`, attempt incremented; cap → failed.
- Queue safety: two concurrent `claimNextRun` calls never claim the same run.

### Tools & permissions (integration)
- `tools.invoke` rejects: non-granted tool, unknown tool, invalid args (Zod), for the exact worker version.
- SSRF guard: private/metadata/localhost URLs rejected; scheme enforcement; redirect re-validation.
- CSV generation: formula-injection prefixes escaped; schema-valid rows only.

### Evals & reviews (integration)
- Deterministic evaluator: volume shortfall (21/30) scores proportionally; schema completeness counts required fields.
- Judge (simulated): returns bounded scores; weights combine to expected overall.
- Deliverable feedback: accept/reject creates user_feedback evaluation and moves worker score.
- Review generation: aggregates correctly; low scores → `recommendedAction: replace`.

### Replacement & versioning (integration)
- `proposeReplacement` on a seeded failing worker: proposal parses, changes non-empty.
- `hireReplacement`: v2 active, v1 `retired`, v1 runs/evaluations intact and still attributed to v1; job unchanged; new runs attribute to v2.

### Tenancy & security (integration)
- For every query helper and mutating action: org B calling with org A's ids → `notFound()`/error, zero data leakage.
- Login rate limit triggers after threshold (unit-level on the bucket).

### End-to-end happy path (`tests/e2e/happy-path.test.ts`)
Simulated mode, one test: NL request → `scopeJob` → `designWorker` → `hireWorker` → `enqueueRun` → `executeRun` → assert deliverable content, evaluation score, usage records, activity feed, workforce query shows the worker with score — the Definition-of-Done loop minus the browser.

## 3. CI (Phase 2)

GitHub Actions: `npx tsc --noEmit` → `npx vitest run` (Postgres service container) → `npm audit --audit-level=high`. PRs blocked on red.
