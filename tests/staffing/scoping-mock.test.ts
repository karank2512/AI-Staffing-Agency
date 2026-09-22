import { describe, expect, it } from "vitest";
import { JobSpecSchema, MAX_FOLLOW_UP_QUESTIONS, ScopingQuestionsSchema, detectJobFamily } from "@/server/domain";
import { detectCadence, detectCount, detectFormat, mentionsSending } from "@/server/staffing/cues";
import { mockJobSpec, mockScopingQuestions } from "@/server/staffing/scoping-mock";
import { tools } from "@/server/tools";
import { DESCRIPTIONS, FAMILIES, specFor } from "./helpers";

describe("staffing: simulated scoping questions", () => {
  it("detects the intended family for every sample description", () => {
    for (const family of FAMILIES) expect(detectJobFamily(DESCRIPTIONS[family])).toBe(family);
  });

  it("asks at most three schema-valid, family-specific questions with quick-pick suggestions", () => {
    const seen = new Map<string, string[]>();
    for (const family of FAMILIES) {
      const q = mockScopingQuestions(DESCRIPTIONS[family]);
      expect(ScopingQuestionsSchema.safeParse(q).success).toBe(true);
      expect(q.jobFamily).toBe(family);
      expect(q.questions.length).toBeGreaterThan(0);
      expect(q.questions.length).toBeLessThanOrEqual(MAX_FOLLOW_UP_QUESTIONS);
      expect(new Set(q.questions.map((x) => x.id)).size).toBe(q.questions.length);
      for (const question of q.questions) {
        expect(question.suggestions.length).toBeGreaterThanOrEqual(2);
        expect(question.why?.length ?? 0).toBeGreaterThan(10);
      }
      seen.set(family, q.questions.map((x) => x.question));
    }
    // Research asks about focus + volume + recipients; triage asks about routing + priority + cadence.
    expect(seen.get("market_research")).toEqual(expect.arrayContaining([expect.stringMatching(/geographies|segments/i), expect.stringMatching(/how many/i), expect.stringMatching(/receive/i)]));
    expect(seen.get("support_triage")).toEqual(expect.arrayContaining([expect.stringMatching(/categories|teams/i), expect.stringMatching(/priority/i), expect.stringMatching(/how often/i)]));
    expect(seen.get("lead_research")).not.toEqual(seen.get("feedback_analysis"));
  });

  it("derives a working title from the description, dropping the 'I need someone to' preamble", () => {
    const q = mockScopingQuestions(DESCRIPTIONS.market_research);
    expect(q.draftTitle).toMatch(/^Track newly funded AI infrastructure startups/);
    expect(q.draftTitle.length).toBeLessThanOrEqual(120);
    expect(mockScopingQuestions("Do a thing").draftTitle.length).toBeGreaterThanOrEqual(3);
  });

  it("is deterministic", () => {
    expect(mockScopingQuestions(DESCRIPTIONS.finance_ops)).toEqual(mockScopingQuestions(DESCRIPTIONS.finance_ops));
  });
});

describe("staffing: simulated JobSpec reflects the description and answers", () => {
  it("produces a schema-valid spec for every family whose tools are all in the registry", () => {
    for (const family of FAMILIES) {
      const spec = specFor(family);
      expect(JobSpecSchema.safeParse(spec).success).toBe(true);
      expect(spec.jobFamily).toBe(family);
      expect(spec.toolsLikelyNeeded.every((t) => tools.has(t))).toBe(true);
      expect(spec.deliverable.fields.length).toBeGreaterThan(3);
      expect(spec.deliverable.fields.some((f) => f.required)).toBe(true);
      expect(spec.deliverable.fields.every((f) => /^[a-z][a-z0-9_]*$/.test(f.name))).toBe(true);
      expect(spec.deliverable.targetCount).toBeGreaterThan(0);
      expect(spec.successCriteria.length).toBeGreaterThanOrEqual(2);
      if (spec.deliverable.format === "markdown") expect(spec.deliverable.sections.length).toBeGreaterThan(0);
      else expect(spec.deliverable.sections).toEqual([]);
    }
  });

  it("uses the volume answer as targetCount and echoes it in the success criteria", () => {
    const spec = specFor("market_research", {}, { volume: "about 25" });
    expect(spec.deliverable.targetCount).toBe(25);
    expect(spec.successCriteria.find((c) => c.metric === "Records per run")?.target).toBe(">= 25");
    expect(specFor("lead_research").deliverable.targetCount).toBe(25); // "25 new outbound leads" in the description
    expect(specFor("content").deliverable.targetCount).toBe(3); // "three LinkedIn posts"
  });

  it("turns recipients into send_notification + an approval rule, but not when the user keeps it in the workspace", () => {
    const quiet = specFor("market_research", {}, { recipients: "Just me, in the workspace" });
    expect(quiet.toolsLikelyNeeded).not.toContain("send_notification");
    expect(quiet.approvalPolicy.requireApprovalFor).toEqual([]);

    const email = specFor("market_research", {}, { recipients: "Email it to leadership@acme.example" });
    expect(email.toolsLikelyNeeded).toContain("send_notification");
    expect(email.approvalPolicy.requireApprovalFor.length).toBe(1);
    expect(email.approvalPolicy.notes).toContain("leadership@acme.example");

    const slack = specFor("lead_research", {}, { recipients: "Post in Slack #outbound" });
    expect(slack.toolsLikelyNeeded).toContain("send_notification");
    expect(slack.deliverable.format).toBe("csv"); // "post" is a delivery word, not a format word
  });

  it("reads cadence words from the description and answers", () => {
    expect(specFor("support_triage").cadence).toEqual({ kind: "daily", hour: 8 }); // "every morning"
    expect(specFor("market_analysis").cadence).toEqual({ kind: "weekly", hour: 9, dayOfWeek: 1 }); // "every Monday"
    expect(specFor("support_triage", {}, { cadence: "Every hour" }).cadence).toEqual({ kind: "hourly" });
    expect(specFor("support_triage", {}, { cadence: "On demand" }).cadence).toEqual({ kind: "manual" });
    expect(specFor("finance_ops", {}, { recipients: "Email it to cfo@acme.example every Friday at 5pm" }).cadence).toEqual({ kind: "weekly", hour: 17, dayOfWeek: 5 });
    expect(specFor("market_research").deliverable.title).toMatch(/^Weekly /);
  });

  it("switches the format on csv / spreadsheet / json words", () => {
    expect(specFor("market_research", {}, { recipients: "Email the CSV to sales@acme.example" }).deliverable.format).toBe("csv");
    expect(specFor("feedback_analysis", {}, { priorities: "Give me a spreadsheet of everything" }).deliverable.format).toBe("markdown"); // only recipients/format answers count
    const json = mockJobSpec({ description: "Give me the raw records as JSON every day: track competitor pricing changes.", title: "Pricing", jobFamily: "market_analysis", intake: null });
    expect(json.deliverable.format).toBe("json");
    expect(json.deliverable.sections).toEqual([]);
  });

  it("folds free-text answers into constraints and inputs, and reads budget figures", () => {
    const spec = mockJobSpec({
      description: "Track AI infra funding rounds weekly; keep it under $0.50 per run and $10 a month.",
      title: "AI infra funding tracker",
      jobFamily: "market_research",
      intake: { questions: mockScopingQuestions(DESCRIPTIONS.market_research).questions, answers: { focus: "Europe, seed to Series B", recipients: "  " } },
    });
    expect(spec.constraints).toContain("Focus: Europe, seed to Series B");
    expect(spec.budget).toEqual({ maxCostPerRunUsd: 0.5, maxMonthlyUsd: 10 });
    expect(spec.toolsLikelyNeeded).not.toContain("send_notification");

    const leads = specFor("lead_research", {}, { icp: "Series A fintechs hiring a Head of Data" });
    expect(leads.inputs.find((i) => i.name === "Ideal customer profile")).toMatchObject({ source: "user_instruction", description: "Series A fintechs hiring a Head of Data" });
  });
});

describe("staffing: cue detection", () => {
  it("detectCount reads numbers and number words but not durations", () => {
    expect(detectCount("top 10 companies")).toBe(10);
    expect(detectCount("around fifteen")).toBe(15);
    expect(detectCount("25")).toBe(25);
    expect(detectCount("in the last 30 days")).toBeUndefined();
    expect(detectCount("every 2 weeks")).toBeUndefined();
    expect(detectCount("no numbers here")).toBeUndefined();
  });

  it("detectCadence honours explicit day/hour words and falls back otherwise", () => {
    const fallback = { kind: "weekly" as const, hour: 9, dayOfWeek: 1 };
    expect(detectCadence("every Tuesday morning", fallback)).toEqual({ kind: "weekly", hour: 8, dayOfWeek: 2 });
    expect(detectCadence("daily at 6am", fallback)).toEqual({ kind: "daily", hour: 6 });
    expect(detectCadence("nothing about timing", fallback)).toEqual(fallback);
    expect(detectCadence("at 3pm", fallback)).toEqual({ kind: "weekly", hour: 15, dayOfWeek: 1 });
  });

  it("detectFormat and mentionsSending", () => {
    expect(detectFormat("a spreadsheet I can import", "markdown")).toBe("csv");
    expect(detectFormat("a weekly brief", "csv")).toBe("markdown");
    expect(detectFormat("post it in Slack", "csv")).toBe("csv");
    expect(mentionsSending("share it with the team")).toBe(true);
    expect(mentionsSending("ops@acme.example")).toBe(true);
    expect(mentionsSending("keep it in the workspace")).toBe(false);
  });
});
