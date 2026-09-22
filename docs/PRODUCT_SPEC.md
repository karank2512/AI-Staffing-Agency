# Product & UX Specification

The product must feel like **hiring and managing people**, never like operating AI infrastructure. Every screen is judged by: "does this feel like a staffing agency / employee dashboard?"

## 1. Design system

- **Look:** Linear/Ramp/Stripe register — light theme, near-white background (`zinc-50`), white cards with hairline borders (`zinc-200`), strong typographic hierarchy, one restrained accent (indigo-600) used for primary actions only. Status communicated with small dots/pills, not loud colors. No gradients, no glassmorphism, no "AI sparkle" clichés.
- **Type:** Geist Sans (headings tight tracking, `text-sm` body, tabular numerals for metrics). Spacing: 8-pt rhythm, generous whitespace, max-w-6xl content column.
- **Components:** shadcn/ui primitives; shared product components: `WorkerAvatar` (deterministic color + initials, small "AI" glyph badge — workers are always visibly AI), `StatusBadge`, `ScoreRing` (0–100), `MetricCard`, `RunStatusPill`, `EmptyState`, `SimulatedBadge` (amber, in topbar + on simulated artifacts).
- **Copy rules:** contractor language everywhere — "Hire", "Replace", "Performance review", "Alex searched the web for recently funded companies". Banned in primary UI: prompt, model, token, agent, LLM, embedding, orchestration (allowed inside the Debug tab only). Workers are named ("Alex — AI Market Researcher") and always labeled AI; never imply consciousness.
- **States:** every page ships loading skeletons, designed empty states (with a single next-step CTA), and error states with retry. Desktop-first, responsive to ~768px.

## 2. Navigation

Sidebar: **Workforce** (/) · **Jobs** (/jobs) · **Activity** (/activity) · **Usage** (/usage) · **Settings** (/settings), plus a prominent **Hire** button (→ /hire). Topbar: org name, pending-approvals bell (badge count), SimulatedBadge when applicable, user menu (sign out).

## 3. Pages

### Sign-in (`/sign-in`)
Centered card, product one-liner, email+password, demo-credentials hint card ("Demo workspace: demo@aistaff.dev / …"). Errors inline; rate-limit message after repeated failures.

### Workforce dashboard (`/`)
- Header stats: Active workers · Deliverables this week · Success rate · Spend this month.
- Worker cards (primary view): avatar, name, role, status pill (Working = run in progress, Active, Idle, Needs Attention, Paused, Terminated), performance score ring, cost this month, last activity line ("Delivered 10-company market report · 2h ago"). Click → profile.
- Needs-attention workers float to top with amber accents. Empty state: "Your workforce is empty — describe your first job" → Hire.

### Hire flow (`/hire`) — 4 steps, progress indicated, all state server-persisted
1. **Describe:** "What do you need done?" — large textarea, 3 example chips (market research, feedback analysis, lead research). Submit → scoping.
2. **Clarify:** 0–4 follow-up questions (schedule, output format, success criteria, constraints) rendered as simple inputs; skippable with sensible defaults. Never a config form.
3. **Job spec review:** human-readable spec sheet — Objective, Tasks (checklist), Schedule, What success looks like, Output. Buttons: Looks right → / Edit description ←.
4. **Meet your worker (proposal):** contractor card — avatar+name+role, Responsibilities, Expected output, Schedule, Systems used (tool names in plain English, with "needs your approval" flags), Estimated cost (per run + per month), estimated runtime. Buttons: **Hire {name}** (primary) / Adjust job ←. Hiring → toast + redirect to profile with a "first day" callout (Run now).

### Worker profile (`/workers/[id]`) — the heart of the product
Header: avatar, name, "AI {role}", status, Hired {date}, score ring, actions: **Run now**, Pause/Resume, **Replace…**, overflow (Terminate).
Tabs (`?tab=`):
- **Overview:** responsibilities list, current assignment card (job + schedule + next run countdown), KPI tiles (from blueprint KPIs with targets), cost snapshot (today/week/month, per deliverable), latest review summary if any, live "currently working" panel when a run is active (polls status, shows humanized current step).
- **Activity:** reverse-chron humanized feed grouped by run ("8:01 Started daily research", "8:03 Found 74 candidates…"), each run collapsible, link to run detail.
- **Deliverables:** cards with title, date, format icon, Accept / Reject (+optional note) — feeds evaluation; view inline (sanitized markdown / CSV table) + download.
- **Performance:** score trend chart (per run, colored by version), metric breakdown (deterministic/judge/user), tasks completed, success rate, avg cost/run, avg runtime; **Generate performance review** button → review card (strengths/concerns/recommendation) with actions **Improve worker** (→ chat prefill) / **Replace worker** (→ replace dialog) / **Keep current**.
- **Permissions:** allowed tools (plain-English names + what they can do), approval-required flags (toggleable), denied list ("Not allowed: Send emails…"). Server-enforced note.
- **Versions:** timeline — v1 (dates, score, status), v2 …; each shows changeSummary; runs always attributed to their version.
- **Debug** (small "Advanced" tab): raw steps, model calls (provider/model/tier/tokens/cost/latency), tool calls with args/results JSON, simulated flags. The only place AI jargon is allowed.
Right rail: **Message {name}** chat panel — user messages classified: answers render as worker reply; temporary instructions confirm scope ("Noted for upcoming runs"); permanent changes render a proposed-change card (diff summary) with **Approve change** (creates version N+1) / Dismiss.

### Replace dialog (from profile/review)
Side-by-side: Current version (score, cost/run, issues found) vs **Proposed replacement** (estimated score, cost, latency deltas with up/down arrows) + "What changes" list in plain English. Buttons: **Hire replacement** / Keep current. Post-hire: version timeline updated, old runs intact, toast "Maya v2 starts on the next run."

### Run detail (`/runs/[id]`)
Header: worker, version chip, trigger, status pill, duration, cost. Timeline of humanized steps with durations and per-step status; approval banner when `waiting_approval` (action summary + payload preview, **Approve** / **Reject** with note); deliverable section; evaluation section (score + metric bars + judge notes); **Debug** tab as above. Failed runs: plain-English failure explanation + "what happens next" (retry/recovery note).

### Jobs (`/jobs`, `/jobs/[id]`)
List: title, staffed worker, status, created. Detail: original request quote, approved spec (human-readable), spec history, staffing history (worker versions over time), job memory (standing instructions with source + remove action), link to worker.

### Activity (`/activity`)
Org-wide feed, filter by worker/type; approval-required items highlighted with inline actions.

### Usage (`/usage`)
Range picker (7/30/90d). Stat cards: total spend, per-deliverable cost, model vs tools split. Charts (recharts): spend by day (stacked by worker), spend by worker (bar), cost-per-deliverable trend. Table: per worker — runs, deliverables, success %, spend, unit cost. Business language first ("$0.42 per qualified account"), tokens only in tooltips.

### Settings (`/settings`)
Workspace name; Model providers card (OpenAI/Anthropic/Google: Connected/Not configured from env presence, masked; "Simulated mode" explainer when none); budget caps (daily USD, max concurrent runs); danger zone (none in MVP beyond sign-out-everywhere placeholder disabled).

## 4. User-story acceptance map

Each MVP story from the brief maps to: Hiring → /hire steps 1–4; Understanding → spec review + proposal card copy; Deployment → Hire + Run now; Visibility → profile Activity; Deliverables → Deliverables tab + download; Performance → Performance tab + score ring; Cost → Usage + profile cost snapshot; Modification → chat classification + version proposal; Replacement → replace dialog + versions timeline; Safety → Permissions tab + approval banners.
