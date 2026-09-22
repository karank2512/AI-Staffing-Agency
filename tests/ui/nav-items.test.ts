import { describe, expect, it } from "vitest";
import {
  ACCOUNT_ITEMS,
  HIRE_HREF,
  NAV_ITEMS,
  approvalsLabel,
  formatCount,
  isActivePath,
} from "@/components/shell/nav-items";

describe("global nav destinations", () => {
  it("keeps the bar at four text destinations, in order", () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(["Workforce", "Jobs", "Approvals", "Activity"]);
  });

  it("moves Usage and Settings into the account menu, and Hire out of the nav entirely", () => {
    expect(ACCOUNT_ITEMS.map((i) => i.href)).toEqual(["/usage", "/settings"]);
    const hrefs = [...NAV_ITEMS, ...ACCOUNT_ITEMS].map((i) => i.href);
    expect(hrefs).not.toContain(HIRE_HREF);
  });

  it("only Approvals carries a live count", () => {
    expect(NAV_ITEMS.filter((i) => i.badge).map((i) => i.href)).toEqual(["/approvals"]);
  });

  it("has no icons — navigation is plain text", () => {
    for (const item of [...NAV_ITEMS, ...ACCOUNT_ITEMS]) {
      expect(Object.keys(item)).not.toContain("icon");
    }
  });
});

describe("isActivePath", () => {
  it("lights Workforce for every detail route that belongs to it", () => {
    const workforce = NAV_ITEMS[0]!;
    for (const path of ["/workforce", "/workers/abc", "/runs/abc", "/deliverables/abc"]) {
      expect(isActivePath(path, workforce.match), path).toBe(true);
    }
  });

  it("matches on whole segments, not string prefixes", () => {
    expect(isActivePath("/jobs", ["/jobs"])).toBe(true);
    expect(isActivePath("/jobs/abc", ["/jobs"])).toBe(true);
    expect(isActivePath("/jobs-archive", ["/jobs"])).toBe(false);
    expect(isActivePath("/", ["/jobs"])).toBe(false);
  });

  it("never lights two primary destinations at once", () => {
    for (const path of ["/workforce", "/jobs", "/approvals", "/activity", "/workers/x", "/runs/x"]) {
      expect(NAV_ITEMS.filter((i) => isActivePath(path, i.match)), path).toHaveLength(1);
    }
  });
});

describe("approvals count pill", () => {
  it("caps at 99+ so the pill can never widen the bar", () => {
    expect(formatCount(1)).toBe("1");
    expect(formatCount(99)).toBe("99");
    expect(formatCount(100)).toBe("99+");
  });

  it("reads as a sentence for screen readers", () => {
    expect(approvalsLabel(1)).toBe("1 pending approval");
    expect(approvalsLabel(3)).toBe("3 pending approvals");
  });
});
