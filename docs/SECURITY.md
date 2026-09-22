# Security & Production Readiness

Principle: **treat every AI worker as an untrusted contractor, and every client input (including LLM output) as hostile.** No control relies on a system prompt. Server-side enforcement only.

## 1. Threat model

Assets: tenant business data (jobs, deliverables, run history), credentials/API keys, model spend (money), platform integrity.

Adversaries & vectors:

- **External attacker (unauthenticated):** credential stuffing, session forgery, IDOR probing, endpoint scraping, DoS on expensive LLM endpoints.
- **Authenticated tenant (malicious or compromised):** cross-tenant access via id guessing, cost abuse, injection via job descriptions/chat, arbitrary tool invocation attempts.
- **Hostile web content (indirect prompt injection):** fetched pages/search results instructing the agent to exfiltrate data, call unauthorized tools, or poison deliverables.
- **The worker itself (excessive agency):** runaway loops, unbounded spend, unintended side effects.
- **Supply chain / operator error:** leaked secrets, vulnerable dependencies, misconfigured headers.

## 2. Authentication & session

- Auth.js v5 credentials provider; passwords hashed with **bcrypt cost 12**; constant-time comparison (bcrypt native); identical error message for unknown-user vs wrong-password (no user enumeration).
- JWT session cookies: `httpOnly`, `sameSite=lax`, `secure` in production, 30-day max age with rolling refresh; session payload carries `userId`, `organizationId`, `role` — resolved server-side at issue time, never trusted from the client afterward for authorization decisions beyond identity.
- `middleware.ts` gates all `(app)` and `/api` routes (except auth + health); unauthenticated → redirect/401.
- Login endpoint rate-limited (per-IP + per-email token bucket: 5 attempts/min, backoff). CSRF on auth routes handled by Auth.js; server actions get Next.js origin/host verification (enabled by default) — we additionally set `allowedOrigins` explicitly.
- Phase 2: optional TOTP 2FA, OAuth (Google/Microsoft), org invitations with signed, expiring tokens, session revocation list.

## 3. Authorization & tenant isolation

- Every query/mutation scoped by `organizationId` from `requireSession()` — **never from request payload**. Child resources verified through the parent chain in a single `where { id, organizationId }`; mismatch → `notFound()` (404, not 403 — no existence oracle).
- All ids are `cuid()` — non-sequential, non-enumerable.
- Role model (owner/admin/member) exists from day 1; MVP enforces membership; destructive ops (terminate worker, resolve approvals) require admin+ in Phase 2 RBAC tightening.
- No client-side authorization: UI hides what you can't do, server rejects what you may not do.
- Automated test coverage: cross-tenant access attempts for every query helper and action must return not-found (see TESTING.md).

## 4. Tool-layer security (the core of "AI worker as untrusted contractor")

- **Single choke point:** `tools.invoke()` is the only execution path. It (1) loads the `WorkerToolGrant` for the exact WorkerVersion, (2) rejects non-granted tools — even if the LLM asks, (3) Zod-parses args against the tool's schema (unknown keys stripped, sizes bounded), (4) enforces approval gates, (5) records an immutable `ToolCall` audit row. UI/runtime never call a tool's `execute()` directly.
- **Approval gates:** side-effectful tools (`send_email`, future CRM writes) default `requiresApproval: true`; the run pauses (`waiting_approval`), a human approves/rejects with the exact proposed payload displayed; approvals expire (24h → run fails safe).
- **SSRF defense** (`tools/http-guard.ts`) for `fetch_url` / future `http_request`: scheme allowlist (http/https), DNS-resolve then block private/reserved ranges (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16 incl. cloud metadata 169.254.169.254, ::1, fc00::/7), block localhost aliases, cap redirects (3, re-validated per hop), response size cap (2 MB), timeout (10 s), text content-types only.
- **No dynamic execution:** no `eval`, no `Function()`, no shelling out; `calculator` uses a hand-rolled safe expression parser over numbers/operators only.
- **Output-side injection safety:** CSV generation escapes `= + - @ \t` cell prefixes (formula injection); deliverable markdown rendered with a sanitizing renderer (no raw HTML pass-through, no `dangerouslySetInnerHTML` of model output); JSON deliverables rendered as data, never executed.
- Tool results are size-capped and schema-validated before re-entering model context.

## 5. LLM-specific security (OWASP LLM Top 10 mapping)

- **LLM01 Prompt injection:** fetched web/search content is demarcated as untrusted data in prompts; tool allowlists + grants are enforced server-side, so injected "instructions" cannot expand capability; structured outputs Zod-validated; agent never sees or handles secrets.
- **LLM02 Insecure output handling:** every model output parsed/validated before use (`generateObject` + schema; free text sanitized at render). Model output never becomes SQL, shell, HTML, or tool args without validation.
- **LLM04 Model DoS / cost abuse:** hard budgets per run (max steps/model calls/tool calls/tokens/wall-clock from blueprint), per-org concurrency cap and daily USD cap (org settings, enforced at enqueue + per model call), rate limits on scoping/chat/run-now actions.
- **LLM06 Sensitive info disclosure:** provider keys and credentials never enter model context or client bundles; prompts contain only job-scoped data; no cross-tenant data in any context assembly (queries all org-scoped).
- **LLM08 Excessive agency:** grants + approval gates + budgets as above; workers cannot self-modify configuration (version immutability; improvement proposals require human approval).
- **LLM09 Overreliance:** deterministic + judge evaluations, acceptance workflow, "Simulated" and confidence labeling; reviews surface degradation instead of silently trusting output.
- **No chain-of-thought exposure:** we store structured decisions and humanized summaries only.

## 6. Application & platform hardening

- **Input validation:** Zod at every boundary — server actions, route handlers, tool args, LLM outputs, env vars (`config.ts` fails fast on invalid env).
- **Security headers** (middleware/`next.config.ts`): CSP (`default-src 'self'`; Next-compatible script/style policy; `frame-ancestors 'none'`; `object-src 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` minimal, HSTS in production.
- **Rate limiting:** in-memory token buckets per org+IP on login, job scoping, run-now, chat, replacement (the LLM-spend endpoints). Upgrades to Redis/Upstash in Phase 2 for multi-instance.
- **Secrets:** `.env` gitignored; `.env.example` documents every var; no `NEXT_PUBLIC_` secret leakage (lint check); Credential vault rows encrypted AES-256-GCM with `APP_ENCRYPTION_KEY` (32-byte, env-provided), IV+authTag per row; masked rendering only.
- **Downloads:** deliverable download route sets explicit `Content-Type`, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`; content served from DB (no user-controlled paths — no traversal surface).
- **Error hygiene:** `AppError` codes → generic client messages; stack traces and internals only in server logs; 404 for both missing and unauthorized.
- **Dependency hygiene:** pinned stack, lockfile committed, `npm audit` (high+) in CI, no post-install scripts from untrusted packages, minimal dependency surface.
- **DB safety:** Prisma parameterized queries only (raw SQL confined to the documented queue claim, parameter-free); least-privilege DB user in production (no DDL at runtime); TLS to managed Postgres in Phase 2.

## 7. Auditability

- Append-only `ActivityEvent` + immutable `ToolCall`/`ModelCall`/`Approval` rows = full who/what/when for every worker action, human approval, and configuration change (version history with `changeSummary`).
- Debug trace view is org-scoped and permission-checked like all other data.

## 8. Production-readiness checklist (Phase 2 exit gate)

Baseline delivered in Phase 1 (marked ✅ when built), the rest are Phase 2 launch blockers:

- Phase 1: all of sections 2–7 above except where noted "Phase 2"; health endpoint; graceful executor shutdown; seeded-demo credentials documented as demo-only.
- [ ] Hosted TLS + HSTS preload; secrets in platform secret manager (Vercel/Neon), rotated quarterly
- [ ] Managed Postgres with PITR backups + restore drill; connection pooling (pgBouncer)
- [ ] Distributed rate limiting (Upstash); WAF/bot protection at edge; request-id structured logging
- [ ] Error monitoring (Sentry) + uptime alerts + spend-anomaly alerts (daily USD per org vs baseline)
- [ ] Queue moved to Inngest/Trigger.dev with dead-letter handling and idempotency keys
- [ ] 2FA, org invites, session revocation, admin-gated destructive actions
- [ ] Dependency scanning (Dependabot) + CI security gates; `npm audit` clean at high severity
- [ ] Pen-test pass on tenant isolation + SSRF + IDOR (scripted attack suite in CI, external test pre-launch)
- [ ] Data processing inventory + privacy policy + DPA template (design partners); SOC 2 controls mapped (Type I track)
- [ ] Incident response runbook (see OPERATIONS.md): sev levels, key rotation, tenant notification

## 9. Explicit non-claims (honesty ledger)

MVP is a locally run demo: credentials auth with a seeded demo user, in-memory rate limits (single process), no TLS on localhost, no formal pen test yet. It is architected so that Phase 2 hardening is configuration and swaps — not redesign. "No one can hack into it" is approached as: minimized attack surface, defense in depth, verified tenant isolation, and a tested path to the production checklist above — never as a marketing absolute.
