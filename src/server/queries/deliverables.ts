import type { DeliverableFormat, DeliverableStatus, EvaluationType, RunStatus } from "@prisma/client";
import Papa from "papaparse";
import { db } from "@/server/db";
import { EvaluationDetailsSchema, type EvaluationDetails } from "@/server/domain/evaluation";
import { JobSpecSchema } from "@/server/domain/job-spec";
import { notFound } from "@/server/errors";

/**
 * Read models for /deliverables and /deliverables/[deliverableId]. Org-scoped, plain JSON out.
 * Tabular content (CSV / JSON) is turned into rows here so the page can hand them straight to DataTable.
 */

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

const DELIVERABLE_STATUSES: ReadonlySet<string> = new Set<DeliverableStatus>(["PENDING_REVIEW", "ACCEPTED", "REJECTED"]);

export function isDeliverableStatus(value: string | undefined): value is DeliverableStatus {
  return !!value && DELIVERABLE_STATUSES.has(value);
}

/** Records the table can show: an array of flat objects. Anything else → null (the page falls back to raw JSON). */
export function asRecordRows(value: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every((v) => v !== null && typeof v === "object" && !Array.isArray(v))) return null;
  return value as Array<Record<string, unknown>>;
}

/** CSV text → rows (header row = keys). Numeric-looking cells stay strings; DataTable formats them anyway. */
export function parseCsvRows(text: string): Array<Record<string, unknown>> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const parsed = Papa.parse<Record<string, unknown>>(trimmed, { header: true, skipEmptyLines: true, dynamicTyping: true });
  const rows = parsed.data.filter((r) => r && typeof r === "object");
  return rows.length > 0 ? rows : null;
}

/** JSON text → rows when it is an array of records (or `{ records: [...] }`), else null. */
export function parseJsonRows(text: string): Array<Record<string, unknown>> | null {
  try {
    const value: unknown = JSON.parse(text);
    const direct = asRecordRows(value);
    if (direct) return direct;
    const wrapped = (value as { records?: unknown } | null)?.records;
    return asRecordRows(wrapped);
  } catch {
    return null;
  }
}

/** Rows to show for a deliverable: stored `data` records first, else parsed from the content by format. */
export function rowsFor(format: DeliverableFormat, content: string, data: unknown): Array<Record<string, unknown>> | null {
  const stored = asRecordRows(data);
  if (stored) return stored;
  if (format === "CSV") return parseCsvRows(content);
  if (format === "JSON") return parseJsonRows(content);
  return null;
}

/** Every key across the rows, in first-seen order. */
function keysIn(rows: ReadonlyArray<Record<string, unknown>>): string[] {
  const seen = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) seen.add(key);
  return [...seen];
}

/** The header line of CSV text (trimmed, blanks dropped); [] when there is none. */
export function csvHeader(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const first = Papa.parse<unknown[]>(trimmed, { preview: 1, skipEmptyLines: true }).data[0];
  return Array.isArray(first) ? first.map((h) => String(h ?? "").trim()).filter(Boolean) : [];
}

/**
 * Column order for a deliverable's record table. The stored `data` records come back from a Postgres jsonb column,
 * which reorders object keys (shorter keys first, then alphabetical), so their key order means nothing. Preference:
 *   CSV → the content's header line (what the downloaded file shows);
 *   JSON → key order in the content text (JSON.parse keeps it);
 *   otherwise (or when the content has no usable order) → the job spec's deliverable fields.
 * A `rank` column the preferred order doesn't place goes first — rank_records stamps it on top of the spec's fields,
 * and the worker's own CSV exports lead with it. Keys no preferred list mentions are appended in first-seen order;
 * preferred keys no row has are dropped.
 */
export function columnsFor(
  format: DeliverableFormat,
  content: string,
  rows: ReadonlyArray<Record<string, unknown>>,
  specFields: readonly string[] = [],
): string[] {
  const present = keysIn(rows);
  const has = new Set(present);
  const fromContent = format === "CSV" ? csvHeader(content) : format === "JSON" ? keysIn(parseJsonRows(content) ?? []) : [];
  let preferred = fromContent.filter((k) => has.has(k));
  if (preferred.length === 0) preferred = specFields.filter((k) => has.has(k));
  if (has.has("rank") && !preferred.includes("rank")) preferred = ["rank", ...preferred];

  const ordered = [...new Set(preferred)];
  const placed = new Set(ordered);
  for (const key of present) if (!placed.has(key)) ordered.push(key);
  return ordered;
}

/** Field names the job spec asked each record to have, in the spec's order ([] when the spec doesn't parse). */
function specFieldNames(spec: unknown): string[] {
  const parsed = JobSpecSchema.safeParse(spec);
  return parsed.success ? parsed.data.deliverable.fields.map((f) => f.name) : [];
}

// ── Detail ──────────────────────────────────────────────────────────────────

export interface DeliverableEvaluationView {
  id: string;
  type: EvaluationType;
  /** 0..1 */
  score: number;
  passed: boolean;
  summary: string | null;
  details: EvaluationDetails | null;
  createdAt: string;
}

export interface DeliverableDetail {
  id: string;
  title: string;
  summary: string | null;
  format: DeliverableFormat;
  status: DeliverableStatus;
  content: string;
  /** Tabular rows for CSV/JSON deliverables (or any deliverable with stored records). */
  rows: Array<Record<string, unknown>> | null;
  /** Display order for `rows` (see `columnsFor`); null when there are no rows. Pass to DataTable `columns`. */
  columns: string[] | null;
  recordCount: number | null;
  feedback: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  createdAt: string;
  worker: { id: string; name: string; title: string; avatarColor: string };
  job: { id: string; title: string };
  run: { id: string; status: RunStatus; simulated: boolean; finishedAt: string | null };
  version: { id: string; version: number };
  evaluations: DeliverableEvaluationView[];
}

function parseDetails(value: unknown): EvaluationDetails | null {
  const parsed = EvaluationDetailsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function getDeliverableDetail(organizationId: string, deliverableId: string): Promise<DeliverableDetail> {
  const d = await db.deliverable.findFirst({
    where: { id: deliverableId, organizationId },
    include: {
      worker: { select: { id: true, name: true, title: true, avatarColor: true } },
      job: { select: { id: true, title: true } },
      run: { select: { id: true, status: true, simulated: true, finishedAt: true } },
      workerVersion: { select: { id: true, version: true, jobSpec: { select: { spec: true } } } },
      evaluations: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!d) throw notFound("Deliverable");

  const reviewer = d.reviewedById
    ? await db.user.findFirst({ where: { id: d.reviewedById, organizationId }, select: { name: true } })
    : null;
  const rows = rowsFor(d.format, d.content, d.data);
  const columns = rows ? columnsFor(d.format, d.content, rows, specFieldNames(d.workerVersion.jobSpec.spec)) : null;

  return {
    id: d.id,
    title: d.title,
    summary: d.summary,
    format: d.format,
    status: d.status,
    content: d.content,
    rows,
    columns,
    recordCount: Array.isArray(d.data) ? d.data.length : (rows?.length ?? null),
    feedback: d.feedback,
    reviewedByName: reviewer?.name ?? null,
    reviewedAt: iso(d.reviewedAt),
    createdAt: d.createdAt.toISOString(),
    worker: d.worker,
    job: d.job,
    run: { id: d.run.id, status: d.run.status, simulated: d.run.simulated, finishedAt: iso(d.run.finishedAt) },
    version: { id: d.workerVersion.id, version: d.workerVersion.version },
    evaluations: d.evaluations.map((e) => ({
      id: e.id,
      type: e.type,
      score: e.score,
      passed: e.passed,
      summary: e.summary,
      details: parseDetails(e.details),
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

/** What the download route needs: the raw content plus a filename. */
export interface DeliverableFile {
  filename: string;
  contentType: string;
  content: string;
}

const FILE_META: Record<DeliverableFormat, { ext: string; contentType: string }> = {
  MARKDOWN: { ext: "md", contentType: "text/markdown; charset=utf-8" },
  CSV: { ext: "csv", contentType: "text/csv; charset=utf-8" },
  JSON: { ext: "json", contentType: "application/json; charset=utf-8" },
};

/** "Weekly AI Infra Funding Report — 2026-09-17" → "weekly-ai-infra-funding-report-2026-09-17". */
export function slugifyFilename(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "deliverable";
}

export async function getDeliverableFile(organizationId: string, deliverableId: string): Promise<DeliverableFile> {
  const d = await db.deliverable.findFirst({
    where: { id: deliverableId, organizationId },
    select: { title: true, format: true, content: true },
  });
  if (!d) throw notFound("Deliverable");
  const meta = FILE_META[d.format];
  return { filename: `${slugifyFilename(d.title)}.${meta.ext}`, contentType: meta.contentType, content: d.content };
}

// ── Index ───────────────────────────────────────────────────────────────────

export interface DeliverableListItem {
  id: string;
  title: string;
  summary: string | null;
  format: DeliverableFormat;
  status: DeliverableStatus;
  recordCount: number | null;
  createdAt: string;
  worker: { id: string; name: string; avatarColor: string };
  job: { id: string; title: string };
  run: { id: string; simulated: boolean };
  /** Blend of the automated verdicts on 0..100 (null until evaluated). */
  score: number | null;
}

export interface DeliverableListFilters {
  status?: DeliverableStatus;
  workerId?: string;
  limit?: number;
}

export async function listDeliverables(organizationId: string, filters: DeliverableListFilters = {}): Promise<DeliverableListItem[]> {
  const rows = await db.deliverable.findMany({
    where: {
      organizationId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.workerId ? { workerId: filters.workerId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(200, Math.max(1, filters.limit ?? 100)),
    select: {
      id: true,
      title: true,
      summary: true,
      format: true,
      status: true,
      data: true,
      createdAt: true,
      worker: { select: { id: true, name: true, avatarColor: true } },
      job: { select: { id: true, title: true } },
      run: { select: { id: true, simulated: true } },
      evaluations: { where: { type: { in: ["DETERMINISTIC", "LLM_JUDGE"] } }, select: { score: true } },
    },
  });
  return rows.map((d) => ({
    id: d.id,
    title: d.title,
    summary: d.summary,
    format: d.format,
    status: d.status,
    recordCount: Array.isArray(d.data) ? d.data.length : null,
    createdAt: d.createdAt.toISOString(),
    worker: d.worker,
    job: d.job,
    run: d.run,
    score: d.evaluations.length > 0 ? Math.round((d.evaluations.reduce((s, e) => s + e.score, 0) / d.evaluations.length) * 100) : null,
  }));
}

export interface WorkerFilterOption {
  id: string;
  name: string;
  title: string;
  avatarColor: string;
}

/** Workers that have produced at least one deliverable — the options for the index filter. */
export async function listDeliverableWorkers(organizationId: string): Promise<WorkerFilterOption[]> {
  const workers = await db.worker.findMany({
    where: { organizationId, deliverables: { some: {} } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, title: true, avatarColor: true },
  });
  return workers;
}

export interface DeliverableCounts {
  total: number;
  pendingReview: number;
  accepted: number;
  rejected: number;
}

export async function countDeliverables(organizationId: string): Promise<DeliverableCounts> {
  const groups = await db.deliverable.groupBy({ by: ["status"], where: { organizationId }, _count: { _all: true } });
  const count = (status: DeliverableStatus) => groups.find((g) => g.status === status)?._count._all ?? 0;
  const pendingReview = count("PENDING_REVIEW");
  const accepted = count("ACCEPTED");
  const rejected = count("REJECTED");
  return { total: pendingReview + accepted + rejected, pendingReview, accepted, rejected };
}
