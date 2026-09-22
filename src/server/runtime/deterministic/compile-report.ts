import type { ReportSection } from "@/server/domain/blueprint";
import { formatColumnCell, isMoneyColumn } from "./cells";
import type { Stats } from "./compute-stats";
import { asRecords, formatCell, formatNumber, humanizeHeader, isRecord, resolveColumns, type DataRecord } from "./records";
import type { OpResult } from "./result";

/** Facts about the run that the methodology footer cites; gathered by the runtime, never read from the DB here. */
export interface ReportMeta {
  personaName: string;
  now: Date;
  /** Component names in pipeline order. */
  pipeline: string[];
  /** Tools used successfully this run. */
  toolUsage: Array<{ label: string; count: number }>;
  /** Record counts through the cleaning steps, in order. */
  recordTrail: Array<{ label: string; before: number; after: number }>;
}

export interface CompileReportConfig {
  title: string;
  sections: ReportSection[];
  includeMethodology: boolean;
}

const DEFAULT_MAX_ROWS = 25;
const MAX_AUTO_COLUMNS = 8;

export function renderTable(records: DataRecord[], columns?: string[], maxRows = DEFAULT_MAX_ROWS): string[] {
  if (records.length === 0) return ["_No records._"];
  const cols = resolveColumns(records, columns, MAX_AUTO_COLUMNS);
  if (cols.length === 0) return ["_No columns to show._"];
  const shown = records.slice(0, maxRows);
  const lines = [
    `| ${cols.map(humanizeHeader).join(" | ")} |`,
    `| ${cols.map(() => "---").join(" | ")} |`,
    ...shown.map((record) => `| ${cols.map((c) => formatColumnCell(record[c], c)).join(" | ")} |`),
  ];
  if (records.length > shown.length) lines.push("", `_Showing ${shown.length} of ${records.length} records._`);
  return lines;
}

function renderBullets(value: unknown): string[] {
  if (typeof value === "string") {
    const items = value
      .split("\n")
      .map((line) => line.replace(/^[-*•\d.)\s]+/, "").trim())
      .filter(Boolean);
    return items.length > 0 ? items.map((item) => `- ${item}`) : ["_Nothing to list._"];
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return ["_Nothing to list._"];
    return value.map((item) => {
      if (isRecord(item)) {
        const cols = resolveColumns([item], undefined, 4);
        const [first, ...rest] = cols.map((c) => formatColumnCell(item[c], c)).filter(Boolean);
        return `- **${first ?? ""}**${rest.length > 0 ? ` — ${rest.join(" · ")}` : ""}`;
      }
      return `- ${formatCell(item)}`;
    });
  }
  return [`- ${formatCell(value)}`];
}

function renderStats(value: unknown): string[] {
  if (!isRecord(value)) return ["_No statistics available._"];
  const stats = value as Partial<Stats>;
  const lines: string[] = [];
  if (typeof stats.total === "number") lines.push(`**${formatNumber(stats.total)} records** in total.`);
  if (Array.isArray(stats.groups) && stats.groups.length > 0) {
    lines.push("", "| Group | Count | Share |", "| --- | --- | --- |");
    for (const g of stats.groups) {
      if (!isRecord(g)) continue;
      const share = typeof g.share === "number" ? `${Math.round(g.share * 100)}%` : "";
      lines.push(`| ${formatCell(g.key)} | ${formatCell(g.count)} | ${share} |`);
    }
  }
  const numeric = isRecord(stats.numeric) ? Object.entries(stats.numeric) : [];
  if (numeric.length > 0) {
    lines.push("", "| Field | Count | Sum | Mean | Min | Max |", "| --- | --- | --- | --- | --- | --- |");
    for (const [field, summary] of numeric) {
      if (!isRecord(summary)) continue;
      // Sum / mean / min / max of a money field are dollars too; the count never is.
      const cell = (v: unknown) => (isMoneyColumn(field) ? formatColumnCell(v, field) : formatCell(v));
      lines.push(`| ${humanizeHeader(field)} | ${formatCell(summary.count)} | ${cell(summary.sum)} | ${cell(summary.mean)} | ${cell(summary.min)} | ${cell(summary.max)} |`);
    }
  }
  return lines.length > 0 ? lines : ["_No statistics available._"];
}

function renderSection(section: ReportSection, value: unknown): string[] {
  switch (section.as) {
    case "markdown":
      if (value === undefined || value === null) return ["_No content._"];
      return [typeof value === "string" ? value.trim() || "_No content._" : ["```json", JSON.stringify(value, null, 2), "```"].join("\n")];
    case "table":
      return renderTable(asRecords(value), section.columns, section.maxRows ?? DEFAULT_MAX_ROWS);
    case "bullets":
      return renderBullets(value);
    case "stats":
      return renderStats(value);
  }
}

function methodology(meta: ReportMeta): string[] {
  const lines: string[] = [];
  if (meta.pipeline.length > 0) lines.push(`- Pipeline: ${meta.pipeline.join(" → ")}.`);
  if (meta.toolUsage.length > 0) lines.push(`- Tools used: ${meta.toolUsage.map((t) => `${t.label} ×${t.count}`).join(", ")}.`);
  if (meta.recordTrail.length > 0) {
    const first = meta.recordTrail[0];
    const trail = [`${first.before} collected`, ...meta.recordTrail.map((t) => `${t.after} after ${t.label.toLowerCase()}`)];
    lines.push(`- Records: ${trail.join(" → ")}.`);
  }
  lines.push(`- Generated by ${meta.personaName} · ${meta.now.toISOString().slice(0, 10)}`);
  return lines;
}

/** Assemble the markdown report: title, one `##` per section, optional methodology footer. */
export function compileReport(context: Record<string, unknown>, config: CompileReportConfig, meta: ReportMeta): OpResult<string> {
  const lines: string[] = [`# ${config.title.trim()}`, ""];
  for (const section of config.sections) {
    lines.push(`## ${section.heading.trim()}`, "", ...renderSection(section, context[section.sourceKey]), "");
  }
  if (config.includeMethodology) lines.push("## Methodology", "", ...methodology(meta), "");
  const markdown = `${lines.join("\n").trimEnd()}\n`;
  return {
    value: markdown,
    summary: { title: config.title, sections: config.sections.map((s) => `${s.heading} (${s.as})`), chars: markdown.length },
    detail: `${config.sections.length} section${config.sections.length === 1 ? "" : "s"}${config.includeMethodology ? " + methodology" : ""} · ${formatNumber(markdown.length)} chars`,
  };
}
