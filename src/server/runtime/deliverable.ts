import { format } from "date-fns";
import { recordActivity } from "@/server/activity";
import { db, toJson } from "@/server/db";
import { toDbDeliverableFormat } from "@/server/domain";
import type { BlueprintDeliverable } from "@/server/domain/blueprint";
import { oneLine } from "./compact";
import { asRecords, isRecord } from "./deterministic/records";
import type { RunSlice } from "./slice";

/**
 * The Deliverable row is created at the FIRST component boundary where the blueprint's contentKey (and dataKey,
 * when set) exist in the context — later components (e.g. the approval-gated notifier) run after it. Creation is
 * idempotent: the checkpoint remembers the id, and a crash in between is covered by the "existing row" check.
 */

const SUMMARY_CHARS = 280;

export function renderTitle(template: string, args: { jobTitle: string; now: Date }): string {
  return template
    .replace(/\{\{\s*date\s*\}\}/gi, format(args.now, "yyyy-MM-dd"))
    .replace(/\{\{\s*job_title\s*\}\}/gi, args.jobTitle)
    .trim();
}

/** Lines outside fenced code blocks (the fences and everything between them are dropped). */
function proseLines(content: string): string[] {
  const kept: string[] = [];
  let fenced = false;
  for (const line of content.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) kept.push(line);
  }
  return kept;
}

/** Plain-text opening of a markdown document: no headings, tables, code, list markers or emphasis. */
export function narrativeSummary(content: string, max = SUMMARY_CHARS): string {
  const text = proseLines(content)
    .filter((line) => !/^\s*(#|\||---|\*\*\*)/.test(line))
    .map((line) => line.replace(/^[\s>*+-]+|^\s*\d+[.)]\s+/g, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function renderContent(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function hasKeys(deliverable: BlueprintDeliverable, context: Record<string, unknown>): boolean {
  if (context[deliverable.contentKey] === undefined) return false;
  return !deliverable.dataKey || context[deliverable.dataKey] !== undefined;
}

export async function ensureDeliverable(slice: RunSlice): Promise<void> {
  const { cp, run, blueprint, spec } = slice;
  if (cp.deliverableId) return;
  if (!hasKeys(blueprint.deliverable, cp.context)) return;

  const existing = await db.deliverable.findFirst({ where: { runId: run.id, organizationId: run.organizationId }, select: { id: true }, orderBy: { createdAt: "asc" } });
  if (existing) {
    cp.deliverableId = existing.id;
    return;
  }

  const { deliverable } = blueprint;
  const now = new Date();
  const contentValue = cp.context[deliverable.contentKey];
  const dataValue = deliverable.dataKey ? cp.context[deliverable.dataKey] : undefined;
  const records = Array.isArray(dataValue) && dataValue.every(isRecord) ? asRecords(dataValue) : null;
  const content = renderContent(contentValue);
  const title = renderTitle(deliverable.titleTemplate, { jobTitle: spec.title, now });
  const narrative = typeof contentValue === "string" ? narrativeSummary(contentValue) : "";
  const summary = narrative || (records ? `${records.length} record${records.length === 1 ? "" : "s"}` : oneLine(content, SUMMARY_CHARS));

  const created = await db.deliverable.create({
    data: {
      organizationId: run.organizationId,
      jobId: run.jobId,
      workerId: run.workerId,
      workerVersionId: run.workerVersionId,
      runId: run.id,
      title,
      summary,
      format: toDbDeliverableFormat(deliverable.format),
      content,
      ...(records ? { data: toJson(records) } : {}),
      status: "PENDING_REVIEW",
    },
    select: { id: true },
  });
  cp.deliverableId = created.id;

  await slice.steps.record({
    kind: "DELIVERABLE",
    title: `Delivered “${title}”`,
    status: "SUCCEEDED",
    detail: records ? `${records.length} record${records.length === 1 ? "" : "s"} · ${deliverable.format}` : deliverable.format,
    output: { deliverableId: created.id, title, format: deliverable.format, records: records?.length ?? null, chars: content.length },
  });
  await recordActivity({
    organizationId: run.organizationId,
    type: "DELIVERABLE_CREATED",
    title: `${slice.workerName} delivered “${title}”`,
    detail: records ? `${records.length} record${records.length === 1 ? "" : "s"}` : summary,
    workerId: run.workerId,
    jobId: run.jobId,
    runId: run.id,
    actorType: "WORKER",
    actorName: slice.workerName,
    metadata: { deliverableId: created.id },
  });
}
