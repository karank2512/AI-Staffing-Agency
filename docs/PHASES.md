# Delivery Phases

Every phase has scope, security tasks, and an exit gate. Phase 1 is the build executed now; later phases are roadmap with enough detail to start immediately after.

## Phase 0 — Foundations (folded into Phase 1 start)

Scaffold Next.js 15 + strict TS + Tailwind v4 + shadcn/ui; Prisma schema + initial migration on local Postgres 14 (`ai_staffing_agency`, test DB `ai_staffing_agency_test`); Auth.js credentials + middleware; `config.ts` env validation; CI-ready scripts (`dev`, `build`, `test`, `typecheck`, `db:seed`).

## Phase 1 — MVP (this build; target: one continuous build session)

Work breakdown (matches the plan todos):

1. **Scaffold** — repo config, app shell, design tokens, shadcn primitives, nav.
2. **Database** — full schema per [DATA_MODEL.md](./DATA_MODEL.md), migration, then schema FROZEN.
3. **Auth** — credentials sign-in, org-scoped `requireSession()`, login rate limit, security headers.
4. **Models module** — `llm.*` facade, tier registry, pricing, OpenAI/Anthropic/Google adapters, deterministic mock, ModelCall+UsageRecord tracking.
5. **Tools module** — registry, `tools.invoke()` with grants/validation/approvals/audit, 7 MVP tools, SSRF guard, CSV-injection-safe output.
6. **Staffing engine** — follow-up questions, `scopeJob`, `designWorker` with deterministic selection rules, cost estimation, worker naming.
7. **Hire flow UX** — intake → questions → human-readable spec approval → contractor proposal card → `hireWorker` (Worker + Version 1 + grants).
8. **Runtime** — queue (SKIP LOCKED), executor, agent loop with budgets, code steps, state machine, approval pause/resume, scheduler tick, stale-run recovery, dev bootstrap.
9. **Dashboard pages** — Workforce, Jobs, Run detail (+debug trace), Activity, Usage, Settings.
10. **Worker profile** — overview/responsibilities/activity/deliverables/performance/cost/permissions/versions tabs; run-now; pause/resume.
11. **Evaluation** — deterministic + LLM judge + deliverable feedback, worker score, performance review generation.
12. **Talk + Replace** — chat with intent classification (temporary instruction / spec change / question), replacement analysis → proposal diff → hire replacement (version N+1, history preserved).
13. **Seed** — living demo org per DATA_MODEL §5.
14. **Tests** — suite per [TESTING.md](./TESTING.md), including simulated-mode e2e happy path.
15. **Security hardening pass + polish** — headers/CSP verification, rate limits, org-scoping audit against attack tests, loading/empty/error states, README, `.env.example`; final manual end-to-end walkthrough; dev server left running.

**Exit gate:** the 18-point Definition of Done in [MASTER_PLAN.md](./MASTER_PLAN.md) §5, all tests green, typecheck clean.

## Phase 2 — Design-partner beta (weeks 2–6)

Goal: 5–10 real companies using it weekly; production posture.

- **Deploy:** Vercel + Neon Postgres (PITR), preview envs, GitHub Actions CI (typecheck, tests, audit).
- **Queue:** move executor to Inngest/Trigger.dev behind the existing `runtime` contract (enqueue/claim semantics preserved; idempotency keys; dead-letter alerts).
- **Auth:** OAuth (Google), org invitations, 2FA, session revocation.
- **Integrations (behind existing tool + credential abstractions):** Google Sheets export, Slack delivery/notifications, Gmail send (approval-gated), HubSpot read/create. Each ships with grant defaults + approval policy.
- **Billing:** Stripe customer + metered subscription reading `UsageRecord`; per-worker subscription plans; spend caps surfaced in Settings.
- **Evaluation depth:** golden datasets per job family; regression eval on version replacement (new version must beat old on golden set before "Hire Replacement" is recommended).
- **Security:** complete the production checklist in [SECURITY.md](./SECURITY.md) §8.
- **Exit gate:** 10 orgs, 25 active workers, weekly retention > 80%, zero cross-tenant findings from scripted attack suite + external pen test, billing live.

## Phase 3 — Proven-worker marketplace (months 2–4)

- Worker archetypes with cross-customer track records (privacy-safe aggregate metrics); "hire with references."
- Autonomous improvement: system drafts Version N+1 proposals from run analysis on a schedule; human approves; A/B replacement testing (`replacement_test` runs compare old vs new on the same task before cutover).
- Team-of-workers: manager component coordinating specialist workers on one job.
- Outcome billing ($/qualified lead) on accepted deliverables.
- **Exit gate:** marketplace live with ≥5 archetypes, ≥30% of new hires from archetypes, autonomous proposals adopted ≥25% of the time.

## Phase 4 — AI Workforce layer (months 4–12)

- Departments/teams, enterprise RBAC + SSO (SAML/OIDC), audit export, data residency options.
- Private data connectors (warehouses, internal APIs) through the credential vault; per-connector permission templates.
- Routing tuned per job family from accumulated evaluation corpus (the moat compounding).
- SOC 2 Type II; usage-based margin optimization dashboards (COGS per deliverable trend).

## Cross-phase engineering rules

- Contracts in [CONTRACTS.md](./CONTRACTS.md) hold across phases; swaps happen behind them.
- Migrations additive; never destructive without a migration plan and backup verification.
- Every phase ends with: tests green, security checklist delta closed, README/docs updated.
