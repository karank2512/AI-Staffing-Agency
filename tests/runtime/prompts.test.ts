import { describe, expect, it } from "vitest";
import type { AgentComponent } from "@/server/domain/blueprint";
import { parseCheckpoint } from "@/server/runtime/checkpoint";
import { compact, oneLine } from "@/server/runtime/compact";
import { narrativeSummary, renderTitle } from "@/server/runtime/deliverable";
import { parseJsonAnswer } from "@/server/runtime/json";
import { buildInitialMessage, buildSystemPrompt } from "@/server/runtime/messages";
import { parseAgentInput, readStructuredInputs } from "@/server/simulation/brain/input";
import { makeBlueprint } from "../helpers/fixtures";

const analyst = makeBlueprint().components.find((c): c is AgentComponent => c.type === "agent" && c.id === "analyst")!;

describe("runtime: initial user message", () => {
  it("follows the format the simulation brain documents: one `## <key>` per input key, raw strings, fenced json otherwise", () => {
    const message = buildInitialMessage(
      { inputKeys: ["job_brief", "instructions", "records", "missing"] },
      { job_brief: "# Job: AI Infrastructure Funding Tracker\n\nObjective: find rounds.", instructions: ["Focus on vector databases", "top 5"], records: [{ company: "Vectorloom", stage: "Series B" }] },
    );
    expect(message).toBe(
      [
        "Here is everything you need for this run.",
        "",
        "## job_brief",
        "# Job: AI Infrastructure Funding Tracker",
        "",
        "Objective: find rounds.",
        "",
        "## instructions",
        "```json",
        '[\n  "Focus on vector databases",\n  "top 5"\n]',
        "```",
        "",
        "## records",
        "```json",
        '[\n  {\n    "company": "Vectorloom",\n    "stage": "Series B"\n  }\n]',
        "```",
        "",
        "## missing",
        "(not available for this run)",
      ].join("\n"),
    );

    // …and the brain reads every section back, even when a raw string contains its own `##` headings.
    const parsed = parseAgentInput([{ role: "user", content: message }], ["job_brief", "instructions", "records"]);
    expect(Object.keys(parsed.sections).sort()).toEqual(["instructions", "job_brief", "records"]);
    expect(parsed.sections.job_brief).toContain("# Job: AI Infrastructure Funding Tracker");
    expect(readStructuredInputs(parsed).records).toEqual([{ company: "Vectorloom", stage: "Series B" }]);
  });

  it("gives the brain records + stats from a real analyst input", () => {
    const stats = { total: 3, groups: [{ key: "vector db", count: 2, share: 0.67 }], numeric: {} };
    const message = buildInitialMessage({ inputKeys: ["job_brief", "records", "stats"] }, { job_brief: "brief", records: [{ company: "A" }, { company: "B" }], stats });
    const inputs = readStructuredInputs(parseAgentInput([{ role: "user", content: message }], ["job_brief", "records", "stats"]));
    expect(inputs.records).toHaveLength(2);
    expect(inputs.stats).toMatchObject({ total: 3 });
  });

  it("builds a live-mode system prompt from the component's instructions plus platform rules", () => {
    const system = buildSystemPrompt({ name: "Alex", title: "AI Market Researcher" }, analyst);
    expect(system.startsWith("You are Alex, AI Market Researcher")).toBe(true);
    expect(system).toContain(analyst.instructions);
    expect(system).toContain("Only use tools when they genuinely help");
    expect(system).toContain(`at most ${analyst.maxTurns} turns`);
    expect(system).toContain("Markdown prose");
    const json = buildSystemPrompt({ name: "Alex", title: "AI Market Researcher" }, { ...analyst, outputFormat: "json", outputSchemaHint: "array of {company}" });
    expect(json).toContain("ONLY valid JSON");
    expect(json).toContain("array of {company}");
  });
});

describe("runtime: final-answer JSON parsing", () => {
  it.each([
    ['[{"a":1}]', [{ a: 1 }]],
    ['```json\n[{"a":1}]\n```', [{ a: 1 }]],
    ['```\n{"records":[{"a":1}]}\n```', [{ a: 1 }]],
    ['Here are the results:\n\n[{"a":1},{"a":2}]\n\nLet me know if you need more.', [{ a: 1 }, { a: 2 }]],
    ['{"records":[{"a":1}],"note":"x"}', [{ a: 1 }]],
    ['{"data":[1,2]}', [1, 2]],
    ['{"total":3,"groups":[]}', { total: 3, groups: [] }],
  ])("parses %j", (text, expected) => {
    expect(parseJsonAnswer(text)).toEqual({ ok: true, value: expected });
  });

  it("reports unusable answers", () => {
    expect(parseJsonAnswer("")).toMatchObject({ ok: false });
    expect(parseJsonAnswer("I could not find anything.")).toMatchObject({ ok: false, error: expect.stringContaining("no valid JSON") });
    expect(parseJsonAnswer("[{ broken")).toMatchObject({ ok: false });
  });
});

describe("runtime: deliverable helpers", () => {
  it("renders title templates", () => {
    const now = new Date(2026, 8, 18, 15);
    expect(renderTitle("Weekly Report — {{date}}", { jobTitle: "Funding Tracker", now })).toBe("Weekly Report — 2026-09-18");
    expect(renderTitle("{{ job_title }} ({{DATE}})", { jobTitle: "Funding Tracker", now })).toBe("Funding Tracker (2026-09-18)");
    expect(renderTitle("Plain", { jobTitle: "x", now })).toBe("Plain");
  });

  it("summarizes the narrative opening of a markdown document without markup", () => {
    const md = "# Report\n\n| a | b |\n| --- | --- |\n\n## Summary\n\nVector databases led with **$52M** across 3 rounds ([source](http://x.example)).\n- bullet one\n\n```json\n[1]\n```";
    expect(narrativeSummary(md)).toBe("Vector databases led with $52M across 3 rounds (source). bullet one");
    expect(narrativeSummary("x".repeat(500)).length).toBe(280);
    expect(narrativeSummary("x".repeat(500)).endsWith("…")).toBe(true);
  });
});

describe("runtime: checkpoint + trace compaction", () => {
  it("parses stored checkpoints leniently and rejects garbage", () => {
    expect(parseCheckpoint(null)).toBeNull();
    expect(parseCheckpoint("nope")).toBeNull();
    expect(parseCheckpoint({ componentIndex: "x" })).toBeNull();
    const cp = parseCheckpoint({ componentIndex: 2, context: { records: [] }, agent: { componentId: "notifier", messages: [{ role: "user", content: "hi" }], turn: 1, pendingToolCalls: [] } });
    expect(cp).toMatchObject({ version: 1, componentIndex: 2, nextStepIndex: 0, counters: { modelCalls: 0, toolCalls: 0, costUsd: 0, activeMs: 0 } });
    expect(cp?.agent?.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("clips long strings and big arrays while keeping JSON browsable", () => {
    const out = compact({ text: "x".repeat(5000), list: Array.from({ length: 100 }, (_, i) => i), nested: { keep: 1, drop: undefined } }) as Record<string, unknown>;
    expect(String(out.text).length).toBe(4000 + "…[truncated]".length);
    expect((out.list as unknown[]).length).toBe(61);
    expect((out.list as unknown[]).at(-1)).toBe("…[40 more items]");
    expect(out.nested).toEqual({ keep: 1 });
    expect(oneLine("  many \n\n lines   here ", 10)).toBe("many line…");
  });
});
