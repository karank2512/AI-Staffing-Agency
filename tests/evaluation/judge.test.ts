import { describe, expect, it } from "vitest";
import { JudgeOutputSchema } from "@/server/domain/evaluation";
import { buildJudgePrompt, judgeDeliverable, normalizeJudgeOutput } from "@/server/evaluation/judge";
import { assessSignals, mockJudgeOutput } from "@/server/evaluation/judge-mock";
import { measureDeliverable } from "@/server/evaluation/signals";
import { makeBlueprint, makeJobSpec } from "../helpers/fixtures";
import { goodRecords, goodReport, poorRecords, poorReport, subject } from "./helpers";

const spec = makeJobSpec();
const plan = makeBlueprint().evaluation;
const DRY_RUN = { organizationId: "org_unit_test", purpose: "evaluation.judge", persist: false } as const;

describe("evaluation: judge (pure)", () => {
  it("normalizeJudgeOutput clamps scores, drops unknown ids and fills missing criteria with 'not assessed'", () => {
    const normalize = normalizeJudgeOutput(plan.rubric);
    const raw = {
      criteria: [
        { id: "relevance", score: 1.7, reasoning: "great" },
        { id: "relevance", score: 0.1, reasoning: "duplicate id, ignored" },
        { id: "made_up", score: 0.2, reasoning: "not in rubric" },
        { id: "insight", score: "-3", reasoning: 42 },
      ],
      overallReasoning: 7,
    };
    const parsed = JudgeOutputSchema.parse(normalize(raw));
    expect(parsed).toEqual({
      criteria: [
        { id: "relevance", score: 1, reasoning: "great" },
        { id: "insight", score: 0, reasoning: "" },
      ],
      overallReasoning: "",
    });

    const sparse = JudgeOutputSchema.parse(normalize({ criteria: [{ id: "insight", score: "nope" }] }));
    expect(sparse.criteria).toEqual([
      { id: "relevance", score: 0.5, reasoning: "not assessed" },
      { id: "insight", score: 0.5, reasoning: "not assessed" },
    ]);
    expect(normalize(null)).toBeNull();
  });

  it("the prompt carries the job objective, success criteria, rubric, content and sample records", () => {
    const records = Array.from({ length: 30 }, (_, i) => ({ ...goodRecords(1)[0], company: `Company ${i}` }));
    const prompt = buildJudgePrompt({
      spec,
      plan,
      subject: subject({ content: `${goodReport()}\n${"x".repeat(20_000)}`, records }),
      deliverableTitle: "Weekly report",
    });
    expect(prompt).toContain(`Objective: ${spec.objective}`);
    expect(prompt).toContain("At least 10 relevant funded startups per report (target: >= 10)");
    expect(prompt).toContain("- id: relevance | Relevance (weight 2) — Records are genuinely AI infrastructure funding rounds");
    expect(prompt).toContain("Required fields per record: company, stage, amount_usd, source_url.");
    expect(prompt).toContain("## Deliverable: Weekly report (markdown)");
    expect(prompt).toContain("…[truncated");
    expect(prompt).toContain("## Structured records (20 of 30 shown)");
    expect(prompt).toContain("Company 19");
    expect(prompt).not.toContain("Company 20");
  });

  it("mock judge: content-sensitive, deterministic, cites measurable observations", async () => {
    const good = await judgeDeliverable({ spec, plan, subject: subject(), deliverableTitle: "good" }, DRY_RUN);
    const poor = await judgeDeliverable({ spec, plan, subject: subject({ content: poorReport(), records: poorRecords() }), deliverableTitle: "poor" }, DRY_RUN);

    expect(good.simulated).toBe(true);
    expect(good.model).toBe("mock-standard");
    expect(good.score).toBeGreaterThanOrEqual(0.82);
    expect(good.score).toBeLessThanOrEqual(0.97);
    expect(good.passed).toBe(true);
    expect(poor.score).toBeGreaterThanOrEqual(0.3);
    expect(poor.score).toBeLessThanOrEqual(0.65);
    expect(good.score - poor.score).toBeGreaterThanOrEqual(0.2);
    expect(good.criteria.map((c) => c.id)).toEqual(["relevance", "insight"]);
    expect(good.criteria.map((c) => c.weight)).toEqual([2, 1]);

    const goodText = good.criteria.map((c) => c.reasoning).join(" ");
    expect(goodText).toContain("Every record has all required fields");
    expect(goodText).toMatch(/names \d+ items from the data/);
    const poorText = poor.criteria.map((c) => c.reasoning).join(" ");
    expect(poorText).toContain("delivers only 7 of the 10 records");
    expect(poorText).toContain("1 of 7 entries are duplicates");
    expect(poorText).toContain("is missing in 3");
    expect(poor.overallReasoning).toContain("Main issue:");

    const again = await judgeDeliverable({ spec, plan, subject: subject(), deliverableTitle: "good" }, DRY_RUN);
    expect(again.criteria).toEqual(good.criteria);
  });

  it("marks down well-formed records that break the brief's stage / region / sector constraints", () => {
    const brief = makeJobSpec({
      title: "Series A fintech companies in Europe",
      objective: "Every weekday morning, research 15 Series A fintech companies in Europe that are hiring engineers.",
      constraints: [],
    });
    const offBrief = [
      { company: "Ridgeline GPU", stage: "Series C", amount_usd: 210_000_000, category: "GPU Cloud", hq: "Denver, CO", source_url: "https://news.example/a" },
      { company: "Halcyon Compute", stage: "Series B", amount_usd: 85_000_000, category: "GPU Cloud", hq: "Austin, TX", source_url: "https://news.example/b" },
      { company: "Kestrelflow", stage: "Series A", amount_usd: 34_000_000, category: "Inference Platform", hq: "London, UK", source_url: "https://news.example/c" },
    ];
    const onBrief = [
      { company: "Ledgerlight", stage: "Series A", amount_usd: 24_000_000, category: "Payments Infrastructure", hq: "London, UK", source_url: "https://news.example/d" },
      { company: "Paywick", stage: "Series A", amount_usd: 19_000_000, category: "Embedded Finance", hq: "Berlin, Germany", source_url: "https://news.example/e" },
      { company: "Fernbank", stage: "Series A", amount_usd: 31_000_000, category: "Banking-as-a-Service", hq: "Dublin, Ireland", source_url: "https://news.example/f" },
    ];
    const csv = (records: typeof offBrief) => subject({ format: "csv", content: "company,stage\n", records });
    const judged = (records: typeof offBrief) => {
      const signals = measureDeliverable(brief, plan, csv(records));
      const out = mockJudgeOutput(plan.rubric, signals, "seed");
      const total = plan.rubric.reduce((sum, c) => sum + c.weight, 0);
      return { signals, out, score: out.criteria.reduce((sum, c, i) => sum + c.score * plan.rubric[i].weight, 0) / total };
    };

    const bad = judged(offBrief);
    expect(bad.signals.constraintFit).toEqual({
      checked: 3,
      fitting: 0,
      labels: ["Series A", "Europe", "fintech"],
      examples: ["Ridgeline GPU (Series C · Denver, CO · GPU Cloud)", "Halcyon Compute (Series B · Austin, TX · GPU Cloud)"],
    });
    const good = judged(onBrief);
    expect(good.signals.constraintFit).toMatchObject({ checked: 3, fitting: 3 });
    expect(bad.score).toBeLessThan(0.45);
    expect(good.score - bad.score).toBeGreaterThan(0.35);
    expect(bad.out.overallReasoning).toContain("Main issue: None of the 3 records match the brief (Series A, Europe, fintech)");
    expect(bad.out.criteria.every((c) => c.reasoning.startsWith("None of the 3 records match the brief"))).toBe(true);

    // The default AI-infrastructure tracker's records all fit its own brief, so nothing is marked down.
    const plain = measureDeliverable(spec, plan, subject());
    expect(plain.constraintFit?.fitting).toBe(plain.constraintFit?.checked);
    expect(measureDeliverable(makeJobSpec({ title: "Weekly digest", objective: "Summarize what happened.", constraints: [] }), plan, subject()).constraintFit).toBeNull();
  });

  it("signals: a CSV deliverable without records scores every criterion neutrally", () => {
    const s = subject({ format: "csv", content: "company,stage\nA,Seed\n", records: null });
    const signals = measureDeliverable(spec, plan, s);
    expect(signals.recordCount).toBeNull();
    expect(signals.narrativeChars).toBeNull();
    expect(signals.expectedSections).toEqual([]);
    const assessed = assessSignals(signals);
    expect(Object.values(assessed).every((a) => a.value === null)).toBe(true);
    const out = mockJudgeOutput(plan.rubric, signals, s.content);
    expect(out.criteria.every((c) => c.score === 0.5)).toBe(true);
  });
});
