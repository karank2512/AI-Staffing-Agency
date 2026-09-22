import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { simulation } from "@/server/simulation";
import { tools } from "@/server/tools";
import type { TypedToolDefinition } from "@/server/tools/define";
import { SAMPLE_DATASETS, SearchResultSchema, TOOL_NAMES, type ToolName } from "@/server/tools/schemas";
import { createTestOrg } from "../helpers/factory";
import { createHiredWorker } from "../helpers/fixtures";
import { createRun, ctxFor, makeCtx, NOTIFICATION_INPUT } from "./helpers";

/**
 * Tool unit tests exercise `execute` directly; permission enforcement around it is covered in permissions.test.ts.
 * The registry erases the per-tool types; every definition was built with defineTool, so the cast is exact.
 */
function tool<N extends ToolName>(name: N): TypedToolDefinition<N> {
  const def = tools.get(name);
  if (!def) throw new Error(`tool ${name} missing from the registry`);
  return def as unknown as TypedToolDefinition<N>;
}

describe("registry", () => {
  it("lists all eight contract tools with consistent metadata", () => {
    const listed = tools.list();
    expect(listed.map((t) => t.name)).toEqual(TOOL_NAMES);
    for (const def of listed) {
      expect(def.displayName).toBeTruthy();
      expect(def.description.length).toBeGreaterThan(20);
      expect(def.humanDescription).toBeTruthy();
      expect(def.costPerCallUsd).toBeGreaterThanOrEqual(0);
      expect(typeof def.humanize).toBe("function");
      expect(typeof def.execute).toBe("function");
    }
  });

  it("marks send_notification as the only external_write tool and defaults it to approval", () => {
    const writers = tools.list().filter((t) => t.sideEffect === "external_write");
    expect(writers.map((t) => t.name)).toEqual(["send_notification"]);
    expect(tool("send_notification").defaultRequiresApproval).toBe(true);
    expect(tools.list().filter((t) => t.defaultRequiresApproval).map((t) => t.name)).toEqual(["send_notification"]);
  });

  it("get/has ignore unknown names, including prototype keys", () => {
    expect(tools.has("web_search")).toBe(true);
    expect(tools.has("constructor")).toBe(false);
    expect(tools.has("__proto__")).toBe(false);
    expect(tools.get("toString")).toBeUndefined();
    expect(tools.get("nope")).toBeUndefined();
  });

  it("specsFor keeps order, skips unknown names and collapses duplicates", () => {
    const specs = tools.specsFor(["fetch_url", "bogus", "web_search", "fetch_url"]);
    expect(specs.map((s) => s.name)).toEqual(["fetch_url", "web_search"]);
    expect(specs[0].inputSchema.safeParse({ url: "https://example.com" }).success).toBe(true);
    expect(specs[0].description).toBe(tool("fetch_url").description);
  });
});

describe("web_search (simulated)", () => {
  it("returns deterministic fixture results shaped per SearchResultSchema", async () => {
    const a = await tool("web_search").execute({ query: "AI infrastructure funding rounds", maxResults: 5 }, makeCtx());
    const b = await tool("web_search").execute({ query: "AI infrastructure funding rounds", maxResults: 5 }, makeCtx());
    expect(a.simulated).toBe(true);
    expect(a.output.results).toHaveLength(5);
    for (const r of a.output.results) expect(SearchResultSchema.safeParse(r).success).toBe(true);
    expect(a.output.results.every((r) => r.url.includes(".example"))).toBe(true);
    expect(a.output).toEqual(b.output);
  });

  it("defaults to 6 results and stays simulated when no key resolves even if ctx is live", async () => {
    let asked: string | undefined;
    const ctx = makeCtx({ simulated: false, getSecret: async (name) => ((asked = name), undefined) });
    const result = await tool("web_search").execute({ query: "vector database startups" }, ctx);
    expect(asked).toBe("TAVILY_API_KEY");
    expect(result.simulated).toBe(true);
    expect(result.output.results).toHaveLength(6);
  });

  it("humanizes with the quoted query", () => {
    expect(tool("web_search").humanize({ query: "AI infra funding" })).toBe("Searched the web for “AI infra funding”");
  });
});

describe("fetch_url (simulated)", () => {
  it("reads a fixture page for a search result URL", async () => {
    const search = await tool("web_search").execute({ query: "AI infrastructure funding", maxResults: 3 }, makeCtx());
    const url = search.output.results[0].url;
    const page = await tool("fetch_url").execute({ url }, makeCtx());
    expect(page.simulated).toBe(true);
    expect(page.output.url).toBe(url);
    expect(page.output.title).toBeTruthy();
    expect(page.output.text.length).toBeGreaterThan(100);
    expect(page.output.text.length).toBeLessThanOrEqual(12_100);
  });

  it("uses the simulated web for .example hosts even when the context is live", async () => {
    const page = await tool("fetch_url").execute({ url: "https://news.example/some/article" }, makeCtx({ simulated: false }));
    expect(page.simulated).toBe(true);
    expect(page.output.text).toBeTruthy();
  });

  it("still refuses unsafe URLs in simulated mode", async () => {
    await expect(tool("fetch_url").execute({ url: "http://169.254.169.254/latest/meta-data/" }, makeCtx())).rejects.toMatchObject({
      code: "TOOL_ERROR",
      message: expect.stringContaining("private or reserved"),
    });
    await expect(tool("fetch_url").execute({ url: "ftp://files.example/report.csv" }, makeCtx())).rejects.toMatchObject({ code: "TOOL_ERROR" });
  });
});

describe("extract_data (simulated)", () => {
  it("pulls records with the requested fields out of fixture page text", async () => {
    const search = await tool("web_search").execute({ query: "AI infrastructure funding", maxResults: 3 }, makeCtx());
    const page = await tool("fetch_url").execute({ url: search.output.results[0].url }, makeCtx());
    const fields = ["company", "stage", "amount_usd", "source_url"];
    const result = await tool("extract_data").execute({ text: page.output.text, fields, maxRecords: 5 }, makeCtx());
    expect(result.simulated).toBe(true);
    expect(result.output.records.length).toBeGreaterThan(0);
    expect(result.output.records.length).toBeLessThanOrEqual(5);
    for (const record of result.output.records) expect(Object.keys(record)).toEqual(expect.arrayContaining(fields));
    expect(result.output.records).toEqual(simulation.extractRecords(page.output.text, fields, { maxRecords: 5 }));
  });

  it("routes through llm.generateObject when the context is live (mock provider under FORCE_SIMULATED)", async () => {
    const t = await createTestOrg("tools-extract");
    try {
      const hired = await createHiredWorker(t.organization.id);
      const run = await createRun(t.organization.id, hired);
      const ctx = ctxFor(t.organization.id, hired, run.id, { simulated: false });
      const result = await tool("extract_data").execute({ text: "Acme raised a $10M Series A led by Foo Ventures.", fields: ["company", "stage"] }, ctx);
      expect(result.simulated).toBe(true);
      expect(Array.isArray(result.output.records)).toBe(true);
      // The model call meters itself; the tool must not report a second cost for it.
      expect(result.costUsd).toBeUndefined();
      const calls = await db.modelCall.findMany({ where: { runId: run.id } });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ purpose: "tool.extract_data", tier: "fast", workerId: hired.worker.id, simulated: true });
    } finally {
      await t.cleanup();
    }
  });
});

describe("read_dataset", () => {
  it.each(SAMPLE_DATASETS)("serves the %s sample dataset with a total", async (dataset) => {
    const result = await tool("read_dataset").execute({ dataset, limit: 5 }, makeCtx());
    expect(result.simulated).toBe(true);
    expect(result.output.dataset).toBe(dataset);
    expect(result.output.records).toHaveLength(5);
    expect(result.output.total).toBeGreaterThan(5);
    expect(result.output.total).toBe(simulation.dataset(dataset).length);
  });

  it("normalizes dataset names and rejects unknown ones with the available list", async () => {
    const result = await tool("read_dataset").execute({ dataset: "Customer Feedback" }, makeCtx());
    expect(result.output.dataset).toBe("customer_feedback");
    expect(result.output.records.length).toBe(result.output.total);
    await expect(tool("read_dataset").execute({ dataset: "crm_accounts" }, makeCtx())).rejects.toMatchObject({
      code: "TOOL_ERROR",
      message: expect.stringContaining("customer_feedback, funding_rounds, support_tickets"),
    });
  });
});

describe("csv_export", () => {
  it("derives columns in first-seen order and encodes nested values", async () => {
    const records = [
      { company: "Acme", amount_usd: 1000000, tags: ["a", "b"] },
      { company: "Bolt, Inc.", amount_usd: null, extra: 'He said "hi"' },
    ];
    const result = await tool("csv_export").execute({ records }, makeCtx());
    expect(result.simulated).toBe(false);
    expect(result.output.rowCount).toBe(2);
    expect(result.output.csv.split("\n")).toEqual(['company,amount_usd,tags,extra', 'Acme,1000000,"[""a"",""b""]",', '"Bolt, Inc.",,,"He said ""hi"""']);
  });

  it("honours explicit columns and neutralizes spreadsheet formulas", async () => {
    const result = await tool("csv_export").execute({ records: [{ a: "=SUM(1)", b: 2, c: 3 }], columns: ["c", "a"] }, makeCtx());
    expect(result.output.csv.split("\n")[0]).toBe("c,a");
    expect(result.output.csv.split("\n")[1]).toMatch(/^3,"?'=SUM\(1\)"?$/);
  });

  it("handles no records", async () => {
    expect((await tool("csv_export").execute({ records: [] }, makeCtx())).output).toEqual({ csv: "", rowCount: 0 });
    expect((await tool("csv_export").execute({ records: [], columns: ["x", "y"] }, makeCtx())).output).toEqual({ csv: "x,y", rowCount: 0 });
  });
});

describe("create_report", () => {
  it("assembles a titled markdown document with one H2 per section", async () => {
    const result = await tool("create_report").execute(
      { title: "Weekly Report", sections: [{ heading: "## Summary", body: "Twelve rounds.\n" }, { heading: "Trends", body: "- GPU clouds\n- Agents" }] },
      makeCtx(),
    );
    expect(result.output.markdown).toBe("# Weekly Report\n\n## Summary\n\nTwelve rounds.\n\n## Trends\n\n- GPU clouds\n- Agents\n");
  });
});

describe("send_notification", () => {
  it("delivers to the simulated outbox and says so", async () => {
    const result = await tool("send_notification").execute(NOTIFICATION_INPUT, makeCtx({ simulated: false }));
    expect(result).toEqual({ output: { delivered: true, simulated: true, channel: "email", recipients: 2 }, simulated: true });
  });

  it("humanizes and describes for approval", () => {
    const def = tool("send_notification");
    expect(def.humanize(NOTIFICATION_INPUT)).toBe("Sent “Weekly AI Infra Funding Report” to 2 recipients via email");
    expect(def.humanize({ ...NOTIFICATION_INPUT, channel: "slack", recipients: ["#ops"] })).toBe("Sent “Weekly AI Infra Funding Report” to 1 recipient via Slack");
    const long = { ...NOTIFICATION_INPUT, body: "x".repeat(1000) };
    const approval = def.describeForApproval?.(long);
    expect(approval?.title).toBe("Send “Weekly AI Infra Funding Report” to 2 recipients by email");
    expect(approval?.description?.startsWith("x".repeat(280))).toBe(true);
    expect(approval?.description?.length).toBeLessThanOrEqual(282);
    expect(def.describeForApproval?.(NOTIFICATION_INPUT).description).toBe(NOTIFICATION_INPUT.body);
  });
});

describe("describe()", () => {
  it("never throws and falls back to 'Used <tool>' for unknown tools and bad input", () => {
    expect(tools.describe("bogus_tool", { a: 1 })).toEqual({ title: "Used bogus_tool", approval: { title: "Used bogus_tool" } });
    expect(tools.describe("web_search", { query: 1 })).toEqual({ title: "Used Web search", approval: { title: "Used Web search" } });
    expect(tools.describe("web_search", null)).toEqual({ title: "Used Web search", approval: { title: "Used Web search" } });
    expect(tools.describe("calculator", undefined).title).toBe("Used Calculator");
  });

  it("returns humanized titles and approval headlines for valid input", () => {
    expect(tools.describe("web_search", { query: "AI infra funding" })).toEqual({
      title: "Searched the web for “AI infra funding”",
      approval: { title: "Search the web for “AI infra funding”", description: "Up to 6 results." },
    });
    const notification = tools.describe("send_notification", NOTIFICATION_INPUT);
    expect(notification.title).toBe("Sent “Weekly AI Infra Funding Report” to 2 recipients via email");
    expect(notification.approval).toEqual({ title: "Send “Weekly AI Infra Funding Report” to 2 recipients by email", description: NOTIFICATION_INPUT.body });
    expect(tools.describe("read_dataset", { dataset: "customer_feedback" }).title).toBe("Read the customer_feedback dataset");
    expect(tools.describe("csv_export", { records: [{ a: 1 }] }).title).toBe("Exported 1 record to CSV");
    expect(tools.describe("create_report", { title: "Q3", sections: [{ heading: "A", body: "" }] }).title).toBe("Compiled the report “Q3”");
    expect(tools.describe("extract_data", { text: "x", fields: ["company", "stage"] }).title).toBe("Extracted company, stage from the source text");
    expect(tools.describe("fetch_url", { url: "https://news.example/a" }).title).toBe("Read “https://news.example/a”");
  });

  it("clips very long values in titles", () => {
    const title = tools.describe("web_search", { query: "q".repeat(500) }).title;
    expect(title.length).toBeLessThan(120);
    expect(title.endsWith("…”")).toBe(true);
  });
});
