import { describe, expect, it } from "vitest";
import { JobSpecSchema, MAX_FOLLOW_UP_QUESTIONS, ScopingQuestionsSchema, detectJobFamily } from "@/server/domain";
import { detectFamily } from "@/server/staffing/family-cues";
import { detectCadence, detectCount, detectFormat, mentionsSending } from "@/server/staffing/cues";
import { mockJobSpec, mockScopingQuestions } from "@/server/staffing/scoping-mock";
import { tools } from "@/server/tools";
import { DESCRIPTIONS, FAMILIES, FEEDBACK_DIGEST, FINTECH_LEADS, FUNDING_TRACKER, KAI, PRICING_MONITOR, SEED_PRICING_JOB, scoped, specFor } from "./helpers";

describe("staffing: simulated scoping questions", () => {
  it("detects the intended family for every sample description", () => {
    for (const family of FAMILIES) expect(detectJobFamily(DESCRIPTIONS[family])).toBe(family);
    for (const family of FAMILIES) expect(detectFamily(DESCRIPTIONS[family])).toBe(family);
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
    // Research asks about focus + volume + recipients; triage asks about routing + priority (the description
    // already says "every morning", so it is not asked how often).
    expect(seen.get("market_research")).toEqual(expect.arrayContaining([expect.stringMatching(/geographies|segments/i), expect.stringMatching(/how many/i), expect.stringMatching(/receive/i)]));
    expect(seen.get("support_triage")).toEqual(expect.arrayContaining([expect.stringMatching(/categories|teams/i), expect.stringMatching(/priority/i)]));
    expect(seen.get("support_triage")).not.toEqual(expect.arrayContaining([expect.stringMatching(/how often/i)]));
    expect(seen.get("lead_research")).not.toEqual(seen.get("feedback_analysis"));
    expect(mockScopingQuestions("Triage our inbound support tickets: classify each one and route it to the right team.").questions.map((x) => x.id)).toContain("cadence");
  });

  it("does not ask what the description already says, and narrows what it half-says", () => {
    const kai = mockScopingQuestions(KAI);
    expect(kai.jobFamily).toBe("lead_research");
    // Europe + Series A + fintech + hiring = a profile; "15" = the volume. Only delivery is still open.
    expect(kai.questions.map((x) => x.id)).toEqual(["recipients"]);
    expect(kai.questions.map((x) => x.question).join(" ")).not.toMatch(/geograph|how many|ideal customer/i);

    // "AI infrastructure" is a segment: ask only about regions and stages, with chips in the customer's words.
    const focus = mockScopingQuestions(DESCRIPTIONS.market_research).questions.find((x) => x.id === "focus")!;
    expect(focus.question).toBe("Any geographies or funding stages to focus on within AI infrastructure?");
    expect(focus.suggestions.every((chip) => chip.includes("AI infrastructure"))).toBe(true);

    // Named competitors and the pricing dimension are already given; a count without names narrows the question.
    expect(mockScopingQuestions(PRICING_MONITOR).questions.map((x) => x.id)).toEqual(["recipients"]);
    expect(mockScopingQuestions(SEED_PRICING_JOB).questions.find((x) => x.id === "competitors")?.question).toBe("Which 5 competitors should it cover?");

    // Sending was asked for without an address: ask for the address only.
    const digest = mockScopingQuestions(FEEDBACK_DIGEST).questions;
    expect(digest).toHaveLength(1);
    expect(digest[0]).toMatchObject({ id: "recipients", question: "Which address should reach the product team?" });
    expect(digest[0].suggestions[0]).toBe("Email product@company.com");
    // An address (or "just me") answers delivery outright.
    expect(mockScopingQuestions("Monitor healthtech startups in the US that raised a seed round and email the list to growth@acme.example every Friday.").questions.map((x) => x.id)).toEqual(["volume"]);
  });

  it("asks one open question — or none — when the description answered everything", () => {
    expect(mockScopingQuestions(DESCRIPTIONS.content).questions.map((x) => x.id)).toEqual(["tone"]);
    expect(mockScopingQuestions("Write three friendly LinkedIn posts a week for our developer audience about vector databases.").questions).toEqual([]);
    const q = mockScopingQuestions("Write three friendly LinkedIn posts a week for our developer audience about vector databases.");
    expect(ScopingQuestionsSchema.safeParse(q).success).toBe(true);
  });

  it("is deterministic", () => {
    expect(mockScopingQuestions(DESCRIPTIONS.finance_ops)).toEqual(mockScopingQuestions(DESCRIPTIONS.finance_ops));
    expect(mockScopingQuestions(KAI)).toEqual(mockScopingQuestions(KAI));
  });
});

describe("staffing: job family cue overrides", () => {
  it.each([
    [KAI, "market_research", "lead_research"],
    ["Find 20 companies every week that fit our ideal customer profile and tell me why.", "general", "lead_research"],
    ["Research target accounts in the logistics space we should prioritise for outreach.", "market_research", "lead_research"],
    [PRICING_MONITOR, "market_research", "market_analysis"],
    ["Track the price changes on the plans of Vectorloom, Latchkey AI and Kestrelflow every week.", "general", "market_analysis"],
    ["Track funding rounds in AI infrastructure and summarize what changed.", "market_research", "market_research"],
    ["Triage inbound support tickets from prospects and customers every morning.", "support_triage", "support_triage"],
    ["Categorize the NPS feedback we get and tell me which pricing complaints come up most.", "feedback_analysis", "feedback_analysis"],
  ])("%s → %s, corrected to %s", (description, keyword, corrected) => {
    expect(detectJobFamily(description)).toBe(keyword);
    expect(detectFamily(description)).toBe(corrected);
    expect(mockScopingQuestions(description).jobFamily).toBe(corrected);
  });
});

describe("staffing: simulated working titles", () => {
  it.each([
    [KAI, "European Series A Fintech Lead List"],
    [PRICING_MONITOR, "Competitor Pricing Tracker"],
    [DESCRIPTIONS.market_research, "AI Infrastructure Funding Tracker"],
    [DESCRIPTIONS.market_analysis, "Competitor Pricing and Positioning Analysis"],
    [DESCRIPTIONS.lead_research, "Outbound Lead List"],
    [DESCRIPTIONS.feedback_analysis, "Customer Feedback and NPS Survey Analysis"],
    [DESCRIPTIONS.support_triage, "Inbound Support Ticket Triage"],
    [DESCRIPTIONS.finance_ops, "Vendor Invoices and Expenses Review"],
    [DESCRIPTIONS.content, "LinkedIn Posts on Vector Databases"],
    [DESCRIPTIONS.general, "Weekly Operations Report"],
    [FUNDING_TRACKER, "AI Infrastructure Funding Tracker"],
    [FEEDBACK_DIGEST, "Weekly customer feedback analysis"],
    [FINTECH_LEADS, "Series A Fintech Lead List"],
    [SEED_PRICING_JOB, "Weekly competitor pricing check"],
    ["Overnight support ticket triage. Every morning, classify the tickets that came in overnight and route them.", "Overnight support ticket triage"],
    ["I need someone to track funding in AI infrastructure every week — who raised, how much, from whom.", "AI Infrastructure Funding Tracker"],
    ["Could you please monitor healthtech startups in the US that raised a seed round and email the list to growth@acme.example?", "US Healthtech Funding Tracker"],
    ["Find me leads", "Weekly Lead List"],
  ])("%s → %s", (description, title) => {
    expect(mockScopingQuestions(description).draftTitle).toBe(title);
  });

  it("is always a short noun phrase: at most 60 characters, never an ellipsis", () => {
    const long = `Every weekday morning, research ${"very ".repeat(20)}specialised industrial robotics and warehouse automation hardware companies in Germany that are hiring field engineers.`;
    for (const description of [...Object.values(DESCRIPTIONS), KAI, PRICING_MONITOR, long, "Do a thing", "Hello! Please help."]) {
      const { draftTitle } = mockScopingQuestions(description);
      expect(draftTitle.length).toBeGreaterThanOrEqual(3);
      expect(draftTitle.length).toBeLessThanOrEqual(60);
      expect(draftTitle).not.toMatch(/…|\.\.\.$/);
    }
    expect(mockScopingQuestions(long).draftTitle).toMatch(/Lead List$|Research$/);
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

describe("staffing: the customer's own columns become the spec", () => {
  const names = (spec: ReturnType<typeof scoped>) => spec.deliverable.fields.map((f) => f.name);
  const required = (spec: ReturnType<typeof scoped>) => spec.deliverable.fields.filter((f) => f.required).map((f) => f.name);

  it("reads an explicit column list, maps it to known field names and requires every column", () => {
    const spec = scoped(KAI);
    expect(JobSpecSchema.safeParse(spec).success).toBe(true);
    expect(spec).toMatchObject({ title: "European Series A Fintech Lead List", jobFamily: "lead_research", cadence: { kind: "daily", hour: 8 } });
    expect(spec.deliverable).toMatchObject({ format: "csv", targetCount: 15 });
    // A source column is added so every row can be checked; no template contact or score columns sneak in.
    expect(names(spec)).toEqual(["company", "website", "funding_stage", "headcount", "fit_reason", "source_url"]);
    expect(required(spec)).toEqual(names(spec));
    expect(spec.responsibilities[0]).toBe("Research Series A fintech companies in Europe that are hiring engineers");
    expect(spec.responsibilities[1]).toBe("Capture company, website, the funding stage, headcount and a one-line fit reason for each company, with a source link");
    expect(spec.responsibilities.join(" ")).not.toMatch(/contact|score/i);
    expect(spec.constraints).toContain("Ideal customer profile: Series A fintech companies in Europe that are hiring engineers");
    expect(spec.inputs.find((i) => i.name === "Ideal customer profile")?.description).toBe("Series A fintech companies in Europe that are hiring engineers");
  });

  it("builds a plan-level pricing spec for a competitor pricing monitor", () => {
    const spec = scoped(PRICING_MONITOR);
    expect(spec.jobFamily).toBe("market_analysis");
    expect(names(spec)).toEqual(["competitor", "plan_name", "monthly_price_usd", "seat_minimum", "change_since_last", "source_url", "pricing_model"]);
    // Columns no source may state (a seat minimum, a change) are asked for but never drop a row.
    expect(required(spec)).toEqual(["competitor", "plan_name", "source_url"]);
    expect(spec.deliverable.targetCount).toBe(15); // five competitors × about three plans each
    expect(spec.assumptions.join(" ")).toMatch(/about 15 plan rows per run/);
    expect(spec.constraints).toContain("Coverage: Notion, Coda, Airtable, ClickUp, Monday");
    expect(spec.deliverable.fields.map((f) => f.name)).not.toEqual(expect.arrayContaining(["amount_usd", "lead_investor", "stage"]));
    expect(spec.responsibilities[1]).toBe("Capture the plan name, the monthly price, the seat minimum and any change since the last run for each plan, with a source link");
  });

  it.each([
    [FUNDING_TRACKER, "market_research", ["company", "stage", "amount_usd", "lead_investor", "source_url", "category"]],
    ["Every week, read our NPS responses and give me a table with theme, sentiment, the verbatim and a suggested action.", "feedback_analysis", ["id", "theme", "sentiment", "text", "suggested_action"]],
    ["Triage new support tickets every hour into a CSV with ticket id, subject, priority, team and SLA.", "support_triage", ["id", "subject", "priority", "team", "sla_hours"]],
    ["Each month, go through our card expenses and give me a spreadsheet with vendor, amount, category and why it was flagged.", "finance_ops", ["transaction_id", "vendor", "amount_usd", "category", "flag_reason"]],
  ])("%s", (description, family, fields) => {
    const spec = scoped(description);
    expect(spec.jobFamily).toBe(family);
    expect(names(spec)).toEqual(fields);
  });

  it("tops up the template with a column mentioned in passing, and ignores prose that merely contains a field word", () => {
    const leads = scoped(FINTECH_LEADS);
    expect(names(leads)).toEqual(["company", "website", "contact_name", "contact_title", "contact_email", "linkedin_url", "fit_reason", "fit_score", "source_url"]);
    expect(leads.deliverable.fields.find((f) => f.name === "source_url")?.required).toBe(true);
    // "…with a clear recommendation for our own pricing" is not a request for a price column.
    expect(names(scoped(SEED_PRICING_JOB))).toEqual(specFor("market_analysis").deliverable.fields.map((f) => f.name));
    // No list at all: the family template.
    expect(names(scoped(DESCRIPTIONS.market_research))).toEqual(["company", "category", "stage", "amount_usd", "announced_on", "lead_investor", "hq", "source_url"]);
  });

  it("writes responsibilities around the customer's object instead of a generic template line", () => {
    expect(scoped(DESCRIPTIONS.market_research).responsibilities[0]).toBe("Track newly funded AI infrastructure startups from public sources — news, announcements and company sites");
    expect(scoped(DESCRIPTIONS.support_triage).responsibilities[0]).toBe("Triage inbound support tickets as they arrive in the helpdesk");
    // Nothing concrete to work on ("the things our team cares about"): keep the template's line.
    expect(scoped(DESCRIPTIONS.general).responsibilities[0]).toBe("Gather what the objective needs from the agreed sources");
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
    expect(detectCount("research 15 Series A fintech companies in Europe")).toBe(15);
    expect(detectCount("our five main competitors")).toBe(5);
    expect(detectCount("in 2 weeks we want companies")).toBeUndefined();
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
