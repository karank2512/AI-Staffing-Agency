# UI kit — shared components, helpers and conventions

Everything a page needs to look like the rest of the product. **Import each component from its own file** (no barrel). `src/components/ui/*` are the untouched shadcn primitives (Button, Card, Dialog, Tabs, Table, …) — use them directly, never rewrite them.

## Rules

1. **Server components by default.** Add `"use client"` only for interactivity (state, effects, event handlers, `usePathname`). Keep client files small and leaf-level; fetch data in the server page and pass plain props down.
2. **Never value-import `@/server/*` in a client file** — exceptions: `@/server/domain` and `@/server/runtime/types` (pure, zod-only). Everything else under `@/server`, and Prisma enums, are `import type` only. Client components get data via props, server actions or `/api` routes.
3. Props crossing server → client must be plain JSON: no `Date`, no `Decimal`, no functions (server actions excepted), no lucide component references. Map in `queries/*` (`Number(x)`, `.toISOString()`).
4. Format with `@/lib/format` — never hand-roll money, token, duration or date strings.
5. Light theme only. Don't add `dark:` classes. Don't build class names dynamically (`bg-${color}-100` will not exist in the CSS) — use a static map like `WorkerAvatar` does.
6. Browser storage only inside `useEffect` / event handlers.
7. Language: contractor-style and human — "Hire", "Replace", "Alex searched the web for…", never "agent executed tool".

## Visual language

Calm, confident B2B (Linear / Vercel feel). Slate neutrals, **one** brand accent, subtle borders instead of shadows.

| Thing | Convention |
|---|---|
| Brand accent (`primary`, deep indigo-violet) | Only: the ONE primary button per view, active nav, links, focus rings. Everything else is `variant="outline"` / `"secondary"` / `"ghost"`. Destructive = `variant="destructive"` (soft) — the solid red lives in `ConfirmDialog`. |
| Status colours | **emerald** success/healthy · **amber** attention/waiting on a human · **rose** failure/rejected · **sky** running/in progress · **slate** idle/neutral. Always via `StatusBadge` or `TONE_CLASSES` from `@/lib/status` — don't pick shades ad hoc. |
| Scores (0–100) | ≥ 80 emerald · 65–79 amber · < 65 rose · `null` muted "—". Use `ScoreRing` or `scoreBand()` + `SCORE_BAND_CLASSES`. |
| Simulated | Amber dashed `SimulatedBadge` next to anything produced without live providers. |
| Type | 14px base (`text-sm`, set on `body`). Page title `text-xl font-semibold tracking-tight` (PageHeader does it) · section title 15px semibold (`Section`) · card title = `CardTitle` · secondary text `text-muted-foreground` · captions `text-xs` · group labels: the `eyebrow` utility. |
| Numbers | `tabular-nums` (or the `metric` utility) for anything in a column or that updates live; right-align numeric table columns. Mono (`font-mono`) only for ids, code and JSON. |
| Surfaces | Page background is a near-white slate; content sits on white `Card`s (`ring-1 ring-foreground/10`, no shadow). Nested panels: `rounded-lg border bg-muted/40`. |
| Spacing | Between page sections `space-y-8`; between cards `gap-4`; inside cards the Card's own spacing; stacked form fields `space-y-4`. |
| Icons | lucide, `size-4` inline / `size-3.5` in dense rows, `text-muted-foreground` unless they carry status. |
| Charts (recharts) | Series colours `var(--chart-1)` (brand) → `--chart-2` sky → `--chart-3` emerald → `--chart-4` amber → `--chart-5` rose; grid/axes `var(--border)` / `var(--muted-foreground)`. |

## Page recipe

```tsx
// src/app/(app)/workforce/page.tsx — server component
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Workforce" };          // → "Workforce · AI Staffing Agency"

export default async function WorkforcePage() {
  const s = await requireSession();
  const data = await getWorkforce(s.organizationId);
  return (
    <>
      <PageHeader title="Workforce" description="Your AI workers and how they're doing."
        actions={<Button asChild><Link href="/hire"><Plus /> Hire a worker</Link></Button>} />
      <div className="space-y-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Active workers" value={data.active} icon={Users} />
          …
        </div>
        <Section title="Workers" description="…" actions={<Button variant="outline" size="sm">…</Button>}>
          {data.workers.length === 0
            ? <EmptyState icon={Users} title="No workers yet" description="…" action={…} />
            : <div className="grid gap-4 lg:grid-cols-3">{/* <Card> per worker */}</div>}
        </Section>
      </div>
      <AutoRefresh active={data.hasRunsInFlight} />
    </>
  );
}
```

- `AppShell` (sidebar, container `max-w-7xl`, padding) comes from `(app)/layout.tsx` — pages render content only, **starting with `PageHeader`** (it owns the `<h1>`).
- Detail pages pass `breadcrumbs`. Two-column detail layout: `grid gap-6 lg:grid-cols-3` with the main column `lg:col-span-2`.
- Card pattern: `<Card><CardHeader><CardTitle/><CardDescription/><CardAction/></CardHeader><CardContent/>[<CardFooter/>]</Card>`. Lists inside cards: `divide-y` rows with `py-3`, not nested cards.
- `(app)/loading.tsx`, `error.tsx`, `not-found.tsx` already exist; call `notFound()` from `next/navigation` when a query throws `NOT_FOUND`.
- Server actions: wrap the body in `runAction` and let the client toast — see `@/lib/action-result`.

```ts
// actions.ts                                            // client
export async function pauseAction(id: string) {          const r = await pauseAction(id);
  return runAction(async () => {                         if (!r.ok) toast.error(r.error);
    const s = await requireSession();                    else toast.success("Alex is paused");
    await pauseWorker(s, id);
    revalidatePath(`/workers/${id}`);
  });
}
```

## Components

| Component | Import | Kind |
|---|---|---|
| `AppShell` | `@/components/app-shell` | server (layout only) |
| `PageHeader` | `@/components/page-header` | server-safe |
| `Section` | `@/components/section` | server-safe |
| `StatCard` | `@/components/stat-card` | server-safe |
| `EmptyState` | `@/components/empty-state` | server-safe |
| `StatusBadge` | `@/components/status-badge` | server-safe |
| `WorkerAvatar` | `@/components/worker-avatar` | server-safe |
| `ScoreRing` | `@/components/score-ring` | server-safe |
| `Sparkline` | `@/components/sparkline` | server-safe |
| `SimulatedBadge` | `@/components/simulated-badge` | server-safe (tooltip hydrates) |
| `Markdown` | `@/components/markdown` | server-safe |
| `DataTable` | `@/components/data-table` | server-safe |
| `JsonView` | `@/components/json-view` | server-safe (copy button hydrates) |
| `RelativeTime` | `@/components/relative-time` | client |
| `AutoRefresh` | `@/components/auto-refresh` | client |
| `CopyButton` | `@/components/copy-button` | client |
| `ConfirmDialog` | `@/components/confirm-dialog` | client |

"Server-safe" = no hooks; usable from server and client components alike. All accept an optional `className` unless noted.

### PageHeader — `{ title, description?, actions?, breadcrumbs? }`
`title`/`description`: `ReactNode` · `actions`: `ReactNode` · `breadcrumbs`: `Array<{ label: string; href?: string }>` (last entry = current page, no `href`).
```tsx
<PageHeader title="Alex" description="AI Market Researcher · hired Sep 2"
  breadcrumbs={[{ label: "Workforce", href: "/workforce" }, { label: "Alex" }]}
  actions={<><Button variant="outline">Pause</Button><Button>Run now</Button></>} />
```

### Section — `{ title, description?, actions?, children }` *(extra, not in the contract)*
Titled block (`<h2>`). Does not wrap children in a Card.
```tsx
<Section title="Recent runs" description="Last 10 runs of this worker."
  actions={<Button variant="outline" size="sm" asChild><Link href={`/workers/${id}?tab=activity`}>View all</Link></Button>}>
  <Card>…</Card>
</Section>
```

### StatCard — `{ label, value, hint?, icon?, trend? }`
`value`/`hint`: `ReactNode` (pre-formatted) · `icon`: lucide component **or** element · `trend`: `{ direction?: "up" | "down" | "flat"; label?: string; tone?: "positive" | "negative" | "neutral"; values?: number[] }` — `tone` defaults from direction (override when up is bad, e.g. cost); `values` draws a sparkline.
```tsx
<StatCard label="Spend this month" value={formatUsd(total)} icon={Wallet}
  trend={{ direction: "up", label: "+12% vs last month", tone: "negative", values: dailyCosts }} />
```

### EmptyState — `{ icon?, title, description?, action? }`
```tsx
<EmptyState icon={Inbox} title="No deliverables yet"
  description="Alex's first run is still in progress." action={<Button variant="outline">View run</Button>} />
```

### StatusBadge — `{ kind, status }`
`kind`: `"run" | "worker" | "health" | "deliverable" | "version" | "approval" | "job" | "spec"` · `status`: the raw Prisma enum string. Every value of RunStatus, WorkerStatus, WorkerHealth, DeliverableStatus, WorkerVersionStatus, ApprovalStatus, JobStatus, JobSpecStatus is mapped (compile-time exhaustive); unknown strings degrade to a humanized slate badge. Notable labels: `WAITING_FOR_APPROVAL` → "Needs approval", `NEEDS_ATTENTION` → "Needs attention", `PENDING_REVIEW` → "Awaiting review", `SUCCEEDED` → "Completed", `SPEC_APPROVED` → "Ready to hire", version `REJECTED` → "Declined". RUNNING pulses.
```tsx
<StatusBadge kind="run" status={run.status} />
```
Need the label or colour without the badge? `statusLabel(kind, status)`, `getStatusMeta(kind, status)`, `TONE_CLASSES[tone].{badge,dot,text,soft}` from `@/lib/status`.

### WorkerAvatar — `{ name, color, size? }`
`color`: `Worker.avatarColor` (domain `AVATAR_COLORS` token; unknown → violet) · `size`: `"sm"` 24px · `"md"` 36px (default) · `"lg"` 56px.
```tsx
<WorkerAvatar name={worker.name} color={worker.avatarColor} size="lg" />
```

### ScoreRing — `{ score, size? }`
`score`: `number | null` on 0..100 · `size`: px, default 48 (≈28 in table rows, ≈96 hero). `null` = muted ring with "—" (never a red zero).
```tsx
<ScoreRing score={worker.score} size={96} />          {/* profile hero */}
<ScoreRing score={run.score} size={28} />             {/* table row */}
```

### Sparkline — `{ values, className? }`
Oldest → newest. Size and colour via `className` (uses `currentColor`): `<Sparkline values={trend} className="h-8 w-28 text-emerald-500" />`. Default `h-6 w-20 text-primary`. Use recharts for anything with axes.

### SimulatedBadge — `{ className? }`
Unconditional — you decide when: `{run.simulated ? <SimulatedBadge /> : null}`. The global one is rendered by AppShell.

### Markdown — `{ content }`
Safe renderer for deliverables, reviews, chat replies: headings, paragraphs, nested/ordered/task lists, GFM tables (alignment), bold/italic/strike/inline code, fenced code, blockquotes, rules, links (`http(s)`/`mailto`/relative only; external → `target="_blank" rel="noopener noreferrer nofollow"`). Raw HTML is shown as text. No `dangerouslySetInnerHTML`. Parser: `parseMarkdown` in `@/lib/markdown` (pure, tested).
```tsx
<Card><CardContent><Markdown content={deliverable.content} /></CardContent></Card>
```

### DataTable — `{ rows, columns?, maxRows?, showIndex? }`
`rows`: `Array<Record<string, unknown>>` · `columns`: key order (default: all keys, first-seen) · `maxRows`: default 50 · `showIndex`: default `true` — pass `false` when the records already carry a `rank` column. Humanized headers (`source_url` → "Source URL"), grouped right-aligned numbers (years/ids ungrouped), short external links for URLs, "Yes/No", ISO dates, "—" for empty, sticky header, horizontal scroll, "Showing N of M records" footer. Read-only, for worker-produced records; for app entities (runs, jobs, approvals) build a real table with `@/components/ui/table`.
```tsx
<DataTable rows={deliverable.data} maxRows={100} />
```

### JsonView — `{ value }` (+ optional `label`, `defaultOpen`)
Collapsible (native `<details>`), syntax-tinted, with copy. For debug tabs: checkpoints, blueprints, tool I/O, model requests. Pass the parsed value, not a JSON string.
```tsx
<JsonView label="Checkpoint" value={run.checkpoint} />
<JsonView label="Tool input" value={toolCall.input} defaultOpen />
```

### RelativeTime — `{ iso }`
"5 minutes ago" (auto-updating, hydration-safe) with the absolute time as `title`. `iso` may be `null` → "—". In server-only text use `formatRelativeTime` / `formatDateTime`.
```tsx
<p className="text-xs text-muted-foreground">Last run <RelativeTime iso={worker.lastRunAt} /></p>
```

### AutoRefresh — `{ active, intervalMs? }`
Renders nothing; `router.refresh()` every `intervalMs` (default 4000, min 1000) while `active`; pauses in hidden tabs. Put one at the end of list/detail pages. The run page uses its own `/api/runs/[runId]` polling instead.
```tsx
<AutoRefresh active={runs.some((r) => r.status === "RUNNING" || r.status === "QUEUED")} />
```

### CopyButton — `{ value }` (+ optional `label`)
Icon button; with `label` it becomes a small text button ("Copy CSV"). Safe inside `<summary>` and other clickable parents.
```tsx
<CopyButton value={deliverable.content} label="Copy CSV" />
<CopyButton value={run.id} />
```

### ConfirmDialog — `{ trigger, title, description, confirmLabel, destructive?, onConfirm }`
`onConfirm: () => Promise<void>` — resolve closes the dialog; **throw** to keep it open and toast the message. Pending state, double-submit and dismissal while pending are handled.
```tsx
<ConfirmDialog trigger={<Button variant="destructive">Retire</Button>} title={`Retire ${name}?`}
  description="Queued runs are cancelled. History and deliverables are kept." confirmLabel="Retire worker" destructive
  onConfirm={async () => { const r = await retireAction(id); if (!r.ok) throw new Error(r.error); router.push("/workforce"); }} />
```

### AppShell — `{ user: { name, email, organizationName }, simulated, pendingApprovals, children }`
Used once, by `(app)/layout.tsx`. Nav lives in `shell/nav-items.ts`; detail routes light up their parent via `match` prefixes (`/workers`, `/runs`, `/deliverables` → Workforce). The Approvals count refreshes whenever the layout re-renders (`revalidatePath`, `router.refresh()`, `AutoRefresh`).
```tsx
// src/app/(app)/layout.tsx (already written — for reference)
const s = await requireSession();
const shell = await getShellData(s.organizationId);
return <AppShell user={{ name: s.name, email: s.email, organizationName: s.organizationName }}
  simulated={shell.simulated} pendingApprovals={shell.pendingApprovals}>{children}</AppShell>;
```
Adding a nav destination = one entry in `NAV_GROUPS` (label, href, lucide icon, `match` prefixes).

## Helpers (`src/lib`)

| File | Exports |
|---|---|
| `format.ts` | `formatUsd` ($1,234.50 · <$0.01) · `formatUsdPrecise` ($0.0031) · `formatTokens` (1.2k · 3.4M) · `formatDuration(ms)` (850 ms · 12.4 s · 3m 05s · 1h 12m) · `formatPercent(0..1)` · `formatNumber` · `formatRelativeTime` · `formatDateTime` · `formatDate` · `titleCase` · `sentenceCase` · `pluralize` · `EMPTY`. All accept `null`/`undefined` → "—". |
| `action-result.ts` | `ActionResult<T>`, `runAction(fn)` (rethrows `redirect()`/`notFound()`, maps `AppError`/Zod → message, hides the rest) |
| `status.ts` | `getStatusMeta`, `statusLabel`, `STATUS_META`, `TONE_CLASSES`, `scoreBand`, `SCORE_BAND_CLASSES` |
| `markdown.ts` | `parseMarkdown`, `parseInline`, `inlineToText`, `sanitizeHref` |
| `cell-format.ts`, `json-highlight.ts`, `initials.ts` | internals of DataTable / JsonView / avatars (`displayUrl`, `safeStringify`, `initialsOf` are handy) |
| `utils.ts` | `cn(...)` |
