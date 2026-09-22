import type { Prisma } from "@prisma/client";
import { db, type DbOrTx } from "@/server/db";
import {
  JobSpecSchema,
  ReplacementAnalysisSchema,
  WorkerBlueprintSchema,
  type JobSpec,
  type ReplacementAnalysis,
  type WorkerBlueprint,
} from "@/server/domain";
import { AppError, notFound } from "@/server/errors";
import { estimateCost } from "@/server/staffing";

/**
 * Org-scoped loaders and small text helpers shared across the workers module. Every id that arrives from a
 * client goes through one of these loaders, so the org check is never forgotten at a call site.
 */

export const WORKER_INCLUDE = {
  currentVersion: { include: { jobSpec: true } },
  job: { select: { id: true, title: true, status: true } },
} satisfies Prisma.WorkerInclude;

export type WorkerRecord = Prisma.WorkerGetPayload<{ include: typeof WORKER_INCLUDE }>;

export const VERSION_INCLUDE = {
  worker: { include: WORKER_INCLUDE },
  jobSpec: true,
} satisfies Prisma.WorkerVersionInclude;

export type VersionRecord = Prisma.WorkerVersionGetPayload<{ include: typeof VERSION_INCLUDE }>;

export async function loadWorker(organizationId: string, workerId: string, tx: DbOrTx = db): Promise<WorkerRecord> {
  const worker = await tx.worker.findFirst({ where: { id: workerId, organizationId }, include: WORKER_INCLUDE });
  if (!worker) throw notFound("Worker");
  return worker;
}

export async function loadVersion(organizationId: string, versionId: string, tx: DbOrTx = db): Promise<VersionRecord> {
  const version = await tx.workerVersion.findFirst({ where: { id: versionId, worker: { organizationId } }, include: VERSION_INCLUDE });
  if (!version) throw notFound("Worker version");
  return version;
}

/** Stored blueprints were validated on write; a failure here means the schema moved underneath the data. */
export function parseStoredBlueprint(value: unknown): WorkerBlueprint {
  const parsed = WorkerBlueprintSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError("INTERNAL", "Stored worker blueprint no longer matches the current schema", { issues: parsed.error.issues });
  }
  return parsed.data;
}

export function parseStoredSpec(value: unknown): JobSpec {
  const parsed = JobSpecSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError("INTERNAL", "Stored job spec no longer matches the current schema", { issues: parsed.error.issues });
  }
  return parsed.data;
}

export function parseStoredAnalysis(value: unknown): ReplacementAnalysis | null {
  const parsed = ReplacementAnalysisSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** A candidate blueprint from our own code or a model: invalid → VALIDATION with the issues, never INTERNAL. */
export function validateBlueprint(value: unknown): WorkerBlueprint {
  const parsed = WorkerBlueprintSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`);
    throw new AppError("VALIDATION", `The proposed worker design is not valid: ${issues.slice(0, 5).join("; ")}`, { issues });
  }
  return parsed.data;
}

/** Re-price an edited blueprint and validate it (structure, wiring, check configs). */
export function recostAndValidate(bp: WorkerBlueprint): WorkerBlueprint {
  const withoutCost: Omit<WorkerBlueprint, "costEstimate"> = {
    schemaVersion: bp.schemaVersion,
    jobFamily: bp.jobFamily,
    persona: bp.persona,
    responsibilities: bp.responsibilities,
    components: bp.components,
    tools: bp.tools,
    kpis: bp.kpis,
    evaluation: bp.evaluation,
    deliverable: bp.deliverable,
    schedule: bp.schedule,
    limits: bp.limits,
  };
  return validateBlueprint({ ...withoutCost, costEstimate: estimateCost(withoutCost) });
}

export function requiredSpecFields(spec: JobSpec): string[] {
  return spec.deliverable.fields.filter((f) => f.required).map((f) => f.name);
}

export function replaceHref(workerId: string, versionId: string): string {
  return `/workers/${workerId}/replace/${versionId}`;
}

export const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

export function clip(text: string, max: number): string {
  const flat = oneLine(text);
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export const quote = (text: string, max = 140): string => `“${clip(text, max)}”`;

export const plural = (n: number, word: string, pluralWord = `${word}s`): string => `${n} ${n === 1 ? word : pluralWord}`;

export function versionLabel(status: string): string {
  return status.toLowerCase().replace(/_/g, " ");
}

/** "Weekly on Monday at 9am" inside a sentence: lower-case the first letter only, never the day name. */
export const lowerFirst = (text: string): string => (text.length > 0 ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : text);

/**
 * A KPI value in its display unit — rates as percentages, money as dollars, durations as minutes/seconds, counts
 * as counts — so evidence reads "33% vs target 85%", never "0.3333 vs target 0.85".
 */
export function formatKpiValue(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  switch (unit) {
    case "%":
      return `${Math.round(value * 100)}%`;
    case "$":
      return `$${value.toFixed(value > 0 && value < 0.01 ? 4 : 2)}`;
    case "sec":
    case "s": {
      const seconds = Math.round(value);
      if (seconds < 60) return `${seconds}s`;
      const minutes = Math.floor(seconds / 60);
      const rest = seconds % 60;
      return rest === 0 ? `${minutes}m` : `${minutes}m ${String(rest).padStart(2, "0")}s`;
    }
    default: {
      const rounded = Math.round(value * 10) / 10;
      return unit && unit !== "records" ? `${rounded} ${unit}` : `${rounded}`;
    }
  }
}
