import { describe, expect, it } from "vitest";
import type { WorkerBlueprint } from "@/server/domain";
import { diffBlueprints } from "@/server/workers";
import { changeExcerpt } from "@/server/workers/diff";
import { makeBlueprint } from "../helpers/fixtures";

const byPath = (entries: ReturnType<typeof diffBlueprints>["entries"], path: string) => entries.find((e) => e.path === path);

describe("diffBlueprints", () => {
  it("returns no entries for identical blueprints", () => {
    expect(diffBlueprints(makeBlueprint(), makeBlueprint()).entries).toEqual([]);
  });

  it("labels tier, instruction, tool and step changes in a stable order", () => {
    const before = makeBlueprint({ collectorTier: "fast", withCleaning: false });
    const after = makeBlueprint({ collectorTier: "standard", withCleaning: true, withNotifier: true });
    const collector = after.components.find((c) => c.id === "collector");
    if (collector?.type !== "agent") throw new Error("fixture");
    collector.instructions = `${collector.instructions}\n\nStanding instruction from your manager: cite two sources per round.`;
    after.schedule = { kind: "daily", hour: 8 };
    after.limits = { ...after.limits, maxCostPerRunUsd: 1 };
    after.costEstimate = { ...after.costEstimate, perRunUsd: 0.25, monthlyUsd: 7.5 };

    const { entries } = diffBlueprints(before, after);
    const paths = entries.map((e) => e.path);

    const tier = byPath(entries, "components.collector.modelTier");
    expect(tier).toMatchObject({ label: "Researcher · model tier", kind: "changed", before: "fast", after: "standard" });

    const instructions = byPath(entries, "components.collector.instructions");
    expect(instructions?.label).toBe("Researcher · instructions");
    expect(instructions?.after).toContain("Standing instruction from your manager");
    expect(instructions?.before?.length ?? 0).toBeLessThanOrEqual(160);

    expect(byPath(entries, "components.validate_records")).toMatchObject({ label: "Validate records · step added", kind: "added" });
    expect(byPath(entries, "components.dedupe")).toMatchObject({ label: "Remove duplicates · step added", kind: "added" });
    expect(byPath(entries, "components.notifier")).toMatchObject({ kind: "added" });
    expect(byPath(entries, "tools.send_notification")).toMatchObject({ label: "Tools · send_notification", kind: "added" });
    expect(byPath(entries, "schedule")).toMatchObject({ before: "Weekly on Monday at 9am", after: "Daily at 8am" });
    expect(byPath(entries, "limits.maxCostPerRunUsd")).toMatchObject({ before: "$2.00", after: "$1.00" });
    expect(byPath(entries, "costEstimate.perRunUsd")).toMatchObject({ before: "$0.18", after: "$0.25" });
    expect(byPath(entries, "costEstimate.monthlyUsd")).toMatchObject({ before: "$0.78", after: "$7.50" });

    // Sections come out in a fixed order: pipeline → tools → … → schedule → limits → cost.
    expect(paths.indexOf("components.collector.modelTier")).toBeLessThan(paths.indexOf("tools.send_notification"));
    expect(paths.indexOf("tools.send_notification")).toBeLessThan(paths.indexOf("schedule"));
    expect(paths.indexOf("schedule")).toBeLessThan(paths.indexOf("limits.maxCostPerRunUsd"));
    expect(paths.indexOf("limits.maxCostPerRunUsd")).toBeLessThan(paths.indexOf("costEstimate.perRunUsd"));
    expect(diffBlueprints(before, after).entries).toEqual(entries);
  });

  it("reports removed steps, tool approval changes, KPI and check changes and reordering", () => {
    const before = makeBlueprint({ withNotifier: true });
    const after: WorkerBlueprint = makeBlueprint({ withNotifier: true });
    after.components = after.components.filter((c) => c.id !== "rank");
    after.tools = after.tools.map((t) => (t.toolName === "web_search" ? { ...t, requiresApproval: true } : t));
    after.kpis = after.kpis.map((k) => (k.id === "coverage" ? { ...k, target: 15 } : k));
    after.evaluation = {
      ...after.evaluation,
      deterministicChecks: after.evaluation.deterministicChecks.filter((c) => c.id !== "sections"),
      passThreshold: 0.8,
    };
    // Move the notifier before compile_report to change the order of shared components.
    const notifier = after.components.find((c) => c.id === "notifier");
    const rest = after.components.filter((c) => c.id !== "notifier");
    if (!notifier) throw new Error("fixture");
    const index = rest.findIndex((c) => c.id === "compile_report");
    after.components = [...rest.slice(0, index), notifier, ...rest.slice(index)];

    const { entries } = diffBlueprints(before, after);
    expect(byPath(entries, "components.rank")).toMatchObject({ label: "Rank by round size · step removed", kind: "removed" });
    expect(byPath(entries, "components")?.label).toBe("Pipeline order");
    expect(byPath(entries, "tools.web_search.requiresApproval")).toMatchObject({ before: "no approval needed", after: "approval required" });
    expect(byPath(entries, "kpis.coverage")).toMatchObject({ label: "KPI · Records per report", before: "10 records (higher is better)", after: "15 records (higher is better)" });
    expect(byPath(entries, "evaluation.checks.sections")).toMatchObject({ kind: "removed" });
    expect(byPath(entries, "evaluation.passThreshold")).toMatchObject({ before: "70/100", after: "80/100" });
  });

  it("excerpts around the first difference", () => {
    const base = "A".repeat(200);
    const { before, after } = changeExcerpt(base, `${base} appended text`);
    expect(before.startsWith("…")).toBe(true);
    expect(after).toContain("appended text");
    expect(after.length).toBeLessThanOrEqual(124);
  });
});
