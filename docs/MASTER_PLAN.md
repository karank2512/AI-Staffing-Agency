# AI Staffing Agency — Master Plan

> **The staffing agency for AI workers.** A company describes a job in plain English. The platform scopes it, designs and hires an AI worker, deploys it, measures its performance, and lets the company improve, replace, or fire it — exactly like managing a contractor.

This is the index document. The full plan lives in these files:

| Document | Contents |
| --- | --- |
| [MASTER_PLAN.md](./MASTER_PLAN.md) | Vision, business plan, assumptions, definition of done (this file) |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture, module map, full file tree, runtime design, LLM/tool layers |
| [CONTRACTS.md](./CONTRACTS.md) | Module boundaries, public function signatures, file ownership, frozen files |
| [DATA_MODEL.md](./DATA_MODEL.md) | Complete database schema: entities, enums, indexes, invariants |
| [SECURITY.md](./SECURITY.md) | Threat model, security controls, LLM-specific defenses, production hardening |
| [PHASES.md](./PHASES.md) | All delivery phases with scope, acceptance criteria, and exit gates |
| [PRODUCT_SPEC.md](./PRODUCT_SPEC.md) | Page-by-page UX spec, design system, copy rules, user stories |
| [TESTING.md](./TESTING.md) | Test strategy, coverage map, fixtures, CI |
| [OPERATIONS.md](./OPERATIONS.md) | Environments, local dev, deployment, observability, backups, runbooks |

---

## 1. Product thesis

The fundamental abstraction is **Job → AI Worker → Runs → Deliverables → Evaluation → Improve/Replace**, not "prompt → agent."

Users think in jobs, workers, responsibilities, deliverables, performance, and cost. The platform absorbs all AI infrastructure complexity: model selection, orchestration, tool calling, memory, evaluation. A "worker" is a business abstraction — internally it may be one agent, several agents, deterministic code, API calls, and validation steps.

The product question every decision must answer: **does this feel like hiring someone?**

## 2. The business

### Problem
Companies want AI doing real jobs; almost none can operate it. Agent tooling (LangChain, CrewAI, n8n, Lindy, Relevance) sells building blocks to builders. Businesses want **work done with accountability** — scoping, provisioning, permissions, performance management, replacement. That layer (what a staffing agency + HR system does for human contractors) does not exist for AI labor.

### Why now (2026)
- Tool calling and structured outputs are reliable enough for unattended multi-step work.
- Falling model costs make per-deliverable pricing viable.
- MCP/API standardization commoditizes tool access; value moves to the management/accountability layer.
- Companies have "AI workforce" budget line items with no product to spend them on.

### Market
- Global staffing ≈ $650B; BPO ≈ $300B; the long-term prize is the share of global labor spend that converts to AI labor.
- Bottoms-up: an AI worker at $200–$1,000/mo replaces contractor work costing $3–8k/mo; a customer plausibly employs 3–10 workers.

### Wedge
**Sales research workers** (lead lists, account research, enrichment): measurable daily deliverables, existing $/lead price anchors, fast-moving buyers, tolerance for iteration. Expansion path: feedback analysis → support triage → finance ops → research.

### Business model
- Per-worker subscription ($199–$999/mo by job family) + metered usage with margin.
- Outcome pricing where measurable ($/qualified lead, $/resolved ticket).
- **Margin expansion is engineering:** model routing + replacing LLM steps with deterministic code makes the same job cheaper over time. COGS per deliverable trends down while price holds.

### Moat (data flywheel)
1. Every run produces evaluated, job-linked performance data (spec → blueprint → runs → scores → accept/reject).
2. The Staffing Engine learns which blueprints work per job family → new hires start from proven track records.
3. The blueprint + evaluation corpus compounds; competitors start from zero.
4. The trust layer (permissions, approvals, audit) creates switching costs and is the enterprise wedge.

### Go-to-market
- **Now → month 2:** 5–10 design partners (sales teams at seed–Series B startups); white-glove onboarding; the weekly performance review is the retention ritual.
- **Months 2–4:** self-serve for the lead-research worker; public worker track records; HN/PH launch.
- **Month 4+:** marketplace of proven worker archetypes.

### YC readiness
- Demo: live "describe job → hire → run → deliverable" in under 3 minutes (the MVP is the demo).
- Metrics: active workers employed; worker 30/60/90-day retention; deliverable acceptance rate; revenue per worker; gross margin per worker; replace→improve conversion.
- Milestones: working MVP → 10 design partners / 25 active workers (month 2) → ~$10k MRR with retention proof (month 4) → apply with a live growth curve.

## 3. Phase overview

Full detail in [PHASES.md](./PHASES.md).

- **Phase 1 — MVP (this build):** the complete core loop, locally runnable, simulated-or-real LLM, seeded demo workforce, tests, security baseline.
- **Phase 2 — Design-partner beta (weeks 2–6):** hosted deployment, real queue, real integrations (Sheets/Slack/Gmail/HubSpot), Stripe metering, hardening to production security posture.
- **Phase 3 — Proven-worker marketplace (months 2–4):** hire from track record, autonomous improvement proposals, team-of-workers, outcome billing.
- **Phase 4 — AI Workforce layer (months 4–12):** departments, enterprise SSO/RBAC, private data connectors, compliance exports.

## 4. Standing assumptions and decisions

- **Stack (pinned):** Next.js 15 App Router · React 19 · strict TypeScript · Tailwind v4 · shadcn/ui · Prisma 6 + PostgreSQL 14 (local, already running) · Auth.js v5 credentials · Vercel AI SDK v5 · Zod v4 · Vitest. Monolith with strict internal module boundaries — no microservices, no monorepo packages.
- **Simulated mode is first-class.** No API keys exist on this machine. The entire product works end-to-end on a deterministic mock model provider and simulated tools, clearly badged "Simulated" in the UI. Real providers (OpenAI/Anthropic/Google) activate automatically when keys appear in `.env`. Mock outputs are deterministic (seeded from input hashes, never `Math.random()`).
- **Durable DB-backed run queue** with an in-process executor and scheduler for MVP; swaps to Inngest/Trigger.dev in Phase 2 behind the same `runtime` contract.
- **Workers are versioned and immutable.** A `WorkerVersion` never changes after its first run (`lockedAt`); every change creates version N+1. Runs always reference the exact version that produced them.
- **Every tenant-scoped query filters by `organizationId`** derived from the server session — never from client input.
- **Tool execution has one choke point** (`tools.invoke()`) that enforces grants, validates args, applies approval gates, and records the call. No other code path may execute a tool.
- **No chain-of-thought is stored or shown.** Only structured decisions, humanized activity, and validated outputs.
- Money is stored as Prisma `Decimal`, converted at query boundaries, formatted by shared helpers.

## 5. Definition of done (Phase 1)

The MVP is complete when a user can:

1. Launch the app (`npm run dev`) and 2. sign in (seeded demo account).
3. Describe a new business task in plain English.
4. See it turned into a structured Job Specification (human-readable, approvable).
5. See a proposed AI Worker with 6. responsibilities, tools, expected output, and estimated cost.
7. Click **Hire Worker** and 8. see the worker in the Workforce dashboard.
9. Run the worker and 10. watch execution status update live.
11. Receive a real deliverable and 12. browse full run history.
13. See cost (per run / day / month, per deliverable) and 14. a performance score.
15. Send the worker new instructions (temporary vs permanent handled correctly).
16. View a recommendation to improve or replace it.
17. Replace it with a new version, and 18. still retain the Job and the old version's runs.

Plus: seeded demo org with 3 workers (one needing attention), passing Vitest suite, security baseline per [SECURITY.md](./SECURITY.md), README, `.env.example`.
