# Operations

## 1. Environments

- **dev:** local Next.js + local Postgres 14 (Homebrew, already running). DB `ai_staffing_agency`. Simulated mode unless provider keys present in `.env`.
- **test:** `ai_staffing_agency_test` DB, forced simulated mode, used only by Vitest.
- **prod (Phase 2):** Vercel + Neon Postgres (PITR), secrets in platform env, Inngest/Trigger.dev for the queue, Upstash for rate limits, Sentry for errors.

Environment is validated at boot by `src/server/config.ts` (Zod) — the app fails fast with a readable message on missing/invalid vars.

## 2. Environment variables (`.env.example`)

```bash
# Core
DATABASE_URL="postgresql://localhost:5432/ai_staffing_agency"
TEST_DATABASE_URL="postgresql://localhost:5432/ai_staffing_agency_test"
AUTH_SECRET="<openssl rand -base64 32>"          # Auth.js JWT signing
APP_ENCRYPTION_KEY="<openssl rand -hex 32>"      # AES-256-GCM for Credential vault
APP_URL="http://localhost:3000"

# Model providers — all optional; absent = Simulated mode (fully functional demo)
OPENAI_API_KEY=""
ANTHROPIC_API_KEY=""
GOOGLE_GENERATIVE_AI_API_KEY=""

# Tool providers — optional; absent = simulated web search corpus
TAVILY_API_KEY=""

# Runtime
EXECUTOR_ENABLED="true"        # in-process executor + scheduler loops (dev)
MAX_CONCURRENT_RUNS="2"        # per-process executor concurrency
```

Never commit `.env`. Optional integrations degrade gracefully — the app never crashes because a key is absent.

## 3. Local development

```bash
npm install                       # already-installed deps; do not add packages casually
createdb ai_staffing_agency       # once (createdb ai_staffing_agency_test for tests)
npx prisma migrate dev            # apply migrations (initial setup only)
npm run db:seed                   # demo workspace (idempotent: resets demo org only)
npm run dev                       # http://localhost:3000 — sign in with seeded demo user
npm run test                      # vitest
npm run typecheck                 # tsc --noEmit
```

Before starting a dev server, kill stale ones (`lsof -tiTCP:3000 | xargs kill`) — one server at a time.

## 4. Background execution model

- Dev/MVP: `instrumentation.ts` starts the executor loop (claims queued runs, respects `MAX_CONCURRENT_RUNS` and org concurrency caps), the scheduler tick (60s: due `nextRunAt` → enqueue), and stale-run recovery (120s: dead heartbeats re-queued/failed). Graceful shutdown: stop claiming, finish in-flight step, heartbeat expiry handles the rest (crash-safe by design).
- Prod (Phase 2): same contracts, Inngest functions replace the loops; idempotency keys on enqueue; dead-letter alerting.

## 5. Observability

- Structured server logs (JSON in prod): request id, org id, run id, step key, error codes — never secrets or prompt contents at info level.
- `/api/health`: process + DB round-trip; used by uptime checks.
- Product-level observability is first-class data: ActivityEvents, Run/Step timings, ModelCall/ToolCall latencies and costs — the Usage page doubles as the ops cost dashboard. Spend anomaly alerting in Phase 2 (daily org spend vs trailing baseline).
- Debug trace per run in the UI (org-scoped) is the primary support tool.

## 6. Backups & data

- Dev: `pg_dump ai_staffing_agency` before risky schema work (helper script `npm run db:backup`).
- Prod: Neon PITR + daily logical backups; quarterly restore drill (documented result); retention: run/step/call rows kept indefinitely for MVP (they are the product's moat data); revisit with a retention policy + archival at scale.
- Deletion: org offboarding = export + hard delete subtree (Phase 2 admin path with confirmation + delay window).

## 7. Runbooks (Phase 2 skeletons)

- **Stuck run:** check run heartbeat + last step → `recoverStaleRuns` handles automatically; manual: cancel run (state machine allows), inspect debug trace, re-run.
- **Provider outage:** registry falls back across configured providers by tier; if none, runs fail with retryable errors and recovery re-queues; status banner in Settings.
- **Cost spike:** org daily cap halts enqueue (clear user-facing message); inspect Usage by worker; pause offender.
- **Secret leak:** rotate key in platform env, restart, invalidate sessions (`AUTH_SECRET` rotation), audit ActivityEvents/ToolCalls for abuse window, notify affected tenants per incident policy.
- **Sev levels:** SEV1 cross-tenant data exposure (immediate lockdown + disclosure), SEV2 platform down/spend runaway, SEV3 degraded runs.
