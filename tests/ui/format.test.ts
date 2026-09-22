import { describe, expect, it } from "vitest";
import {
  EMPTY,
  formatDate,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatTokens,
  formatUsd,
  formatUsdPrecise,
  pluralize,
  sentenceCase,
  titleCase,
} from "@/lib/format";

describe("null-safety", () => {
  it("renders an em-dash for null / undefined / NaN in every helper", () => {
    const helpers = [formatUsd, formatUsdPrecise, formatTokens, formatDuration, formatPercent, formatNumber];
    for (const helper of helpers) {
      expect(helper(null)).toBe(EMPTY);
      expect(helper(undefined)).toBe(EMPTY);
      expect(helper(Number.NaN)).toBe(EMPTY);
      expect(helper(Number.POSITIVE_INFINITY)).toBe(EMPTY);
    }
    for (const helper of [formatRelativeTime, formatDateTime, formatDate]) {
      expect(helper(null)).toBe(EMPTY);
      expect(helper(undefined)).toBe(EMPTY);
      expect(helper("")).toBe(EMPTY);
      expect(helper("not a date")).toBe(EMPTY);
    }
    expect(titleCase(null)).toBe(EMPTY);
    expect(sentenceCase(undefined)).toBe(EMPTY);
  });
});

describe("formatUsd", () => {
  it("formats dollars with grouping and two decimals", () => {
    expect(formatUsd(1234.5)).toBe("$1,234.50");
    expect(formatUsd(0.42)).toBe("$0.42");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(12)).toBe("$12.00");
    expect(formatUsd(1_000_000)).toBe("$1,000,000.00");
    expect(formatUsd(-12.5)).toBe("-$12.50");
  });

  it("never shows a real cost as $0.00", () => {
    expect(formatUsd(0.0031)).toBe("<$0.01");
    expect(formatUsd(0.004999)).toBe("<$0.01");
    expect(formatUsd(0.005)).toBe("$0.01");
  });
});

describe("formatUsdPrecise", () => {
  it("keeps up to four decimals below one dollar", () => {
    expect(formatUsdPrecise(0.0031)).toBe("$0.0031");
    expect(formatUsdPrecise(0.0123)).toBe("$0.0123");
    expect(formatUsdPrecise(0.00315)).toMatch(/^\$0\.003[12]$/);
    expect(formatUsdPrecise(0.42)).toBe("$0.42");
    expect(formatUsdPrecise(0.5)).toBe("$0.50");
  });

  it("uses two decimals from one dollar up, and for zero", () => {
    expect(formatUsdPrecise(1.23456)).toBe("$1.23");
    expect(formatUsdPrecise(1234.5)).toBe("$1,234.50");
    expect(formatUsdPrecise(0)).toBe("$0.00");
  });

  it("floors vanishing amounts at the smallest displayable value", () => {
    expect(formatUsdPrecise(0.00004)).toBe("<$0.0001");
    expect(formatUsdPrecise(0.00005)).toBe("$0.0001");
  });
});

describe("formatTokens", () => {
  it("abbreviates thousands and millions", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(842)).toBe("842");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1000)).toBe("1k");
    expect(formatTokens(1234)).toBe("1.2k");
    expect(formatTokens(12_345)).toBe("12.3k");
    expect(formatTokens(3_400_000)).toBe("3.4M");
    expect(formatTokens(2_000_000)).toBe("2M");
    expect(formatTokens(1_250_000_000)).toBe("1.3B");
  });

  it("never rounds into the next unit's territory", () => {
    expect(formatTokens(999_949)).toBe("999.9k");
    expect(formatTokens(999_950)).toBe("1M");
    expect(formatTokens(999_999)).toBe("1M");
  });

  it("rounds fractional counts", () => {
    expect(formatTokens(12.6)).toBe("13");
  });
});

describe("formatDuration", () => {
  it("covers every unit band", () => {
    expect(formatDuration(0)).toBe("0 ms");
    expect(formatDuration(850)).toBe("850 ms");
    expect(formatDuration(1000)).toBe("1.0 s");
    expect(formatDuration(12_400)).toBe("12.4 s");
    expect(formatDuration(185_000)).toBe("3m 05s");
    expect(formatDuration(60_000)).toBe("1m 00s");
    expect(formatDuration(4_320_000)).toBe("1h 12m");
    expect(formatDuration(3_600_000)).toBe("1h 00m");
    expect(formatDuration(100 * 3_600_000)).toBe("4d 04h");
  });

  it("hands values that would round up to the next band", () => {
    expect(formatDuration(999.6)).toBe("1.0 s");
    expect(formatDuration(59_949)).toBe("59.9 s");
    expect(formatDuration(59_960)).toBe("1m 00s");
    expect(formatDuration(3_599_600)).toBe("1h 00m");
  });

  it("clamps negative input", () => {
    expect(formatDuration(-5)).toBe("0 ms");
  });
});

describe("formatPercent", () => {
  it("takes a 0..1 ratio", () => {
    expect(formatPercent(0.847)).toBe("85%");
    expect(formatPercent(0.847, 1)).toBe("84.7%");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(1)).toBe("100%");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-09-17T12:00:00.000Z");

  it("describes the past with an 'ago' suffix", () => {
    expect(formatRelativeTime(new Date("2026-09-17T11:55:00.000Z"), now)).toBe("5 minutes ago");
    expect(formatRelativeTime("2026-09-17T09:00:00.000Z", now)).toBe("3 hours ago");
    expect(formatRelativeTime("2026-09-14T12:00:00.000Z", now)).toBe("3 days ago");
    expect(formatRelativeTime(now.getTime() - 60_000, now)).toBe("1 minute ago");
  });

  it("describes the future (next scheduled run)", () => {
    expect(formatRelativeTime("2026-09-17T14:00:00.000Z", now)).toBe("in 2 hours");
  });

  it("says 'just now' inside ten seconds", () => {
    expect(formatRelativeTime(new Date(now.getTime() - 4_000), now)).toBe("just now");
    expect(formatRelativeTime(new Date(now.getTime() + 4_000), now)).toBe("just now");
    expect(formatRelativeTime(new Date(now.getTime() - 30_000), now)).toBe("30 seconds ago");
  });

  it("defaults `now` to the current time", () => {
    expect(formatRelativeTime(new Date(Date.now() - 120_000))).toBe("2 minutes ago");
  });
});

describe("formatDateTime / formatDate", () => {
  it("formats in local time", () => {
    // Constructed from local components so the assertion holds in any time zone.
    const local = new Date(2026, 8, 17, 14, 45);
    expect(formatDateTime(local)).toBe("Sep 17, 2026, 2:45 PM");
    expect(formatDateTime(local.toISOString())).toBe("Sep 17, 2026, 2:45 PM");
    expect(formatDate(local)).toBe("Sep 17, 2026");
  });
});

describe("titleCase / sentenceCase", () => {
  it("humanizes enum and snake_case identifiers", () => {
    expect(titleCase("market_research")).toBe("Market Research");
    expect(titleCase("NEEDS_ATTENTION")).toBe("Needs Attention");
    expect(titleCase("lead-research")).toBe("Lead Research");
    expect(titleCase("jobFamily")).toBe("Job Family");
    expect(sentenceCase("WAITING_FOR_APPROVAL")).toBe("Waiting for approval");
    expect(sentenceCase("funding_round")).toBe("Funding round");
  });

  it("keeps well-known acronyms upper-case", () => {
    expect(titleCase("source_url")).toBe("Source URL");
    expect(sentenceCase("source_url")).toBe("Source URL");
    expect(sentenceCase("company_id")).toBe("Company ID");
    expect(titleCase("ai_infrastructure")).toBe("AI Infrastructure");
    expect(sentenceCase("amount_usd")).toBe("Amount USD");
  });

  it("preserves author-written caps inside mixed-case text only", () => {
    expect(titleCase("SOC2 compliance report")).toBe("SOC2 Compliance Report");
    expect(titleCase("RUN_FAILED")).toBe("Run Failed");
  });

  it("handles empty and whitespace input", () => {
    expect(titleCase("")).toBe("");
    expect(sentenceCase("   ")).toBe("");
  });
});

describe("pluralize", () => {
  it("picks the right noun form", () => {
    expect(pluralize(1, "run")).toBe("1 run");
    expect(pluralize(0, "run")).toBe("0 runs");
    expect(pluralize(1200, "record")).toBe("1,200 records");
    expect(pluralize(2, "reply", "replies")).toBe("2 replies");
  });
});
