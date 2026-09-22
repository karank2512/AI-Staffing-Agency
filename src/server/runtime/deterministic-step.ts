import { db } from "@/server/db";
import type { DeterministicComponent } from "@/server/domain/blueprint";
import { errorMessage } from "@/server/errors";
import { tools } from "@/server/tools";
import { runDeterministic, type ReportMeta } from "./deterministic";
import { RunFailure } from "./failure";
import type { RunSlice } from "./slice";

/**
 * Runs one deterministic component as a DETERMINISTIC RunStep. The operations themselves are pure; this file
 * gathers the run facts a report's methodology footer cites (pipeline, tools used, record counts) from the trace.
 */

const EMPTY_META: Omit<ReportMeta, "personaName" | "now"> = { pipeline: [], toolUsage: [], recordTrail: [] };

function counts(output: unknown): { before: number; after: number } | null {
  const o = output as { before?: unknown; after?: unknown } | null;
  return typeof o?.before === "number" && typeof o?.after === "number" ? { before: o.before, after: o.after } : null;
}

async function reportMeta(slice: RunSlice): Promise<ReportMeta> {
  const usage = await db.toolCall.groupBy({ by: ["toolName"], where: { runId: slice.run.id, status: "SUCCEEDED" }, _count: { _all: true } });
  const steps = await db.runStep.findMany({
    where: { runId: slice.run.id, kind: "DETERMINISTIC", status: "SUCCEEDED" },
    orderBy: { index: "asc" },
    select: { componentId: true, title: true, output: true },
  });
  // A retried component may have two SUCCEEDED steps; the latest one describes what the report contains.
  const latest = new Map<string, { title: string; before: number; after: number }>();
  for (const step of steps) {
    const c = counts(step.output);
    if (c) latest.set(step.componentId ?? step.title, { title: step.title, ...c });
  }
  return {
    personaName: slice.workerName,
    now: new Date(),
    pipeline: slice.blueprint.components.map((c) => c.name),
    toolUsage: usage
      .map((u) => ({ label: tools.get(u.toolName)?.displayName ?? u.toolName, count: u._count._all }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    recordTrail: [...latest.values()].map((t) => ({ label: t.title, before: t.before, after: t.after })),
  };
}

export async function runDeterministicStep(slice: RunSlice, component: DeterministicComponent): Promise<unknown> {
  const step = await slice.steps.begin({
    kind: "DETERMINISTIC",
    componentId: component.id,
    title: component.name,
    input: { operation: component.operation, config: component.config, inputKeys: component.inputKeys },
  });
  try {
    const meta: ReportMeta = component.operation === "compile_report" ? await reportMeta(slice) : { ...EMPTY_META, personaName: slice.workerName, now: new Date() };
    const result = runDeterministic(component, slice.cp.context, meta);
    await slice.steps.finish(step, { status: "SUCCEEDED", output: result.summary, detail: result.detail });
    return result.value;
  } catch (e) {
    const message = `${component.name} failed: ${errorMessage(e)}`;
    await slice.steps.finish(step, { status: "FAILED", error: message });
    // Deterministic code over the same context fails the same way every time — retrying cannot help.
    throw new RunFailure("VALIDATION", message, false);
  }
}
