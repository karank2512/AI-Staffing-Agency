import { describe, expect, it } from "vitest";
import type { AgentComponent } from "@/server/domain/blueprint";
import { parseAgentInput, readStructuredInputs } from "@/server/simulation/brain/input";
import { makeJobSpec } from "../helpers/fixtures";
import { agentInput, categorizerComponent, componentOf, driveAgent, feedbackSpec, parseRecords, sim } from "./helpers";

const fundingRecords = () => parseRecords(driveAgent({ component: componentOf("collector") }).final);

describe("analyst brain", () => {
  it("writes markdown insights that cite real numbers from the records it was given", () => {
    const records = fundingRecords();
    const run = driveAgent({ component: componentOf("analyst"), context: { records } });
    expect(run.turns).toBe(1);
    expect(run.calls).toHaveLength(0);
    const text = run.final ?? "";

    const total = records.reduce((s, r) => s + Number(r.amount_usd), 0);
    const largest = records.slice().sort((a, b) => Number(b.amount_usd) - Number(a.amount_usd))[0];
    // The analyst groups by the first field that actually splits the data (category when it repeats, else stage).
    const countBy = (field: string) => {
      const counts = new Map<string, number>();
      for (const r of records) counts.set(String(r[field]), (counts.get(String(r[field])) ?? 0) + 1);
      return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    };
    const groups = ["category", "stage"].map(countBy).find((g) => g.some(([, n]) => n > 1)) ?? countBy("stage");
    const [topKey, topCount] = groups[0];

    expect(text).toContain(`**${records.length} funding rounds**`);
    expect(text).toContain(`$${Math.round(total / 1e5) / 10}M`);
    expect(text).toContain(String(largest.company));
    expect(text).toContain(`**${topKey}**`);
    expect(text).toContain(`${topCount} (${Math.round((topCount / records.length) * 100)}%)`);
    expect(text).toMatch(/### Insights\n1\. .+\n2\. .+\n3\. /);
    expect(text).toContain("### What to watch");
    expect(text).not.toMatch(/\bNaN\b|undefined|\[object Object\]/);
  });

  it("is deterministic and reacts to the data (feedback records → sentiment and category numbers)", () => {
    const records = parseRecords(driveAgent({ component: categorizerComponent(), spec: feedbackSpec() }).final);
    const setup = { component: componentOf("analyst"), spec: feedbackSpec(), context: { records } };
    const a = driveAgent(setup).final ?? "";
    expect(driveAgent(setup).final).toBe(a);

    const negative = records.filter((r) => r.sentiment === "negative").length;
    expect(a).toContain(`**${records.length} feedback items**`);
    expect(a).toContain(`${negative} negative`);
    expect(a).toMatch(/\*\*negative\*\* sentiment \(\d+%\)/);
    expect(a).not.toContain("duplicate"); // ids are unique even though customers repeat
  });

  it("works from compute_stats output alone", () => {
    const stats = {
      total: 40,
      groups: [
        { key: "onboarding", count: 12, share: 0.3 },
        { key: "pricing", count: 10, share: 0.25 },
        { key: "mobile", count: 18, share: 0.45 },
      ],
      numeric: { severity_score: { sum: 80, mean: 2, max: 3, min: 1 } },
    };
    const component: AgentComponent = { ...componentOf("analyst"), inputKeys: ["job_brief", "stats"] };
    const text = driveAgent({ component, spec: feedbackSpec(), context: { stats } }).final ?? "";
    expect(text).toContain("**40 feedback items**");
    expect(text).toContain("**mobile** with 18 (45%)");
    expect(text).toContain("3 category values");
    expect(text).toContain("**80**");
  });

  it("falls back to a structured note with the spec's sections when no records are present", () => {
    const spec = makeJobSpec({
      title: "Weekly Remote Work Newsletter",
      jobFamily: "content",
      summary: "Writes a short weekly newsletter about remote work practices.",
      objective: "Draft a weekly newsletter summarizing useful writing about remote team onboarding.",
      responsibilities: ["Find useful recent writing on remote onboarding", "Summarize it in a friendly tone"],
      successCriteria: [{ id: "tone", description: "Reads like a human wrote it" }],
      constraints: [],
      deliverable: { title: "Remote Work Weekly", description: "Newsletter", format: "markdown", fields: [], sections: ["Intro", "This week's picks", "Tip of the week"] },
    });
    const writer: AgentComponent = { ...componentOf("analyst"), id: "writer", inputKeys: ["job_brief"], tools: ["web_search"], maxTurns: 3 };
    const run = driveAgent({ component: writer, spec });
    expect(run.turns).toBe(2);
    expect(run.calls.map((c) => c.name)).toEqual(["web_search"]);
    expect((run.calls[0].input as { query: string }).query).toBe("Remote Work");
    const text = run.final ?? "";
    expect(text).toContain("## Intro");
    expect(text).toContain("## This week's picks");
    expect(text).toContain("## Tip of the week");
    expect(text).toMatch(/\]\(https:\/\/[a-z]+\.example\//);

    const noTools = driveAgent({ component: { ...writer, tools: [] }, spec });
    expect(noTools.turns).toBe(1);
    expect(noTools.final).toContain("## Intro");
  });

  it("parses the runtime's input message defensively", () => {
    const records = [{ company: "Vectorloom", stage: "Series B" }];
    const exact = parseAgentInput([{ role: "user", content: `## job_brief\n# Job\n\n## records\n\`\`\`json\n${JSON.stringify(records)}\n\`\`\`` }], ["job_brief", "records"]);
    expect(readStructuredInputs(exact).records).toEqual(records);

    const loose = parseAgentInput([{ role: "user", content: `### Records:\n${JSON.stringify(records)}\n\n## stats\n{"total": 1, "groups": [{"key": "Series B", "count": 1}], "numeric": {}}` }], ["records", "stats"]);
    const parsed = readStructuredInputs(loose);
    expect(parsed.records).toEqual(records);
    expect(parsed.stats?.total).toBe(1);

    const bare = parseAgentInput([{ role: "user", content: `Here are the rows: ${JSON.stringify(records)} thanks` }], ["records"]);
    expect(readStructuredInputs(bare).records).toEqual(records);

    // A markdown report's own "## Records" heading must not be mistaken for the records input key.
    const report = parseAgentInput([{ role: "user", content: `## report\n# Weekly\n\n## Records\n\n| a |\n|---|\n\n## job_brief\nbrief` }], ["report", "job_brief"]);
    expect(report.sections.report).toContain("## Records");
    expect(report.sections.job_brief).toBe("brief");

    const truncated = parseAgentInput([{ role: "user", content: `## records\n\`\`\`json\n[{"a": 1}, {"a": 2}, {"a": ` }], ["records"]);
    expect(readStructuredInputs(truncated).records).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("routes by shape: json → collector, markdown+records → analyst, notifier when send_notification is offered", () => {
    const analyst = agentInput({ component: componentOf("analyst"), context: { records: fundingRecords().slice(0, 3) } });
    expect(sim.agentTurn(analyst).toolCalls ?? []).toHaveLength(0);
    expect(sim.agentTurn(analyst).text).toContain("### Insights");

    const notifier = agentInput({ component: componentOf("notifier", { withNotifier: true }), context: { report: "hi" } });
    expect(sim.agentTurn(notifier).toolCalls?.[0]?.name).toBe("send_notification");

    const collector = agentInput({ component: componentOf("collector") });
    expect(sim.agentTurn(collector).toolCalls?.[0]?.name).toBe("web_search");
  });
});
