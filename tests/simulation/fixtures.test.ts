import { describe, expect, it } from "vitest";
import { createSimulation, hashSeed, seededPick, seededShuffle } from "@/server/simulation";
import { FIXED_NOW, sim } from "./helpers";

const DAY_MS = 86_400_000;
const daysBetween = (iso: string, now: Date) => (now.getTime() - Date.parse(`${iso}T12:00:00.000Z`)) / DAY_MS;

describe("simulation fixtures", () => {
  it("has at least 40 clearly fictional AI-infrastructure companies with fresh, well-formed funding data", () => {
    const companies = sim.companies();
    expect(companies.length).toBeGreaterThanOrEqual(40);
    expect(new Set(companies.map((c) => c.company)).size).toBe(companies.length);
    expect(new Set(companies.map((c) => c.category)).size).toBeGreaterThanOrEqual(8);
    for (const c of companies) {
      expect(c.website).toMatch(/^https:\/\/[a-z0-9-]+\.example$/);
      expect(c.source_url).toMatch(/^https:\/\/news\.example\/funding\/[a-z0-9-]+$/);
      expect(["Seed", "Series A", "Series B", "Series C"]).toContain(c.stage);
      expect(c.amount_usd).toBeGreaterThan(0);
      expect(c.employees).toBeGreaterThan(0);
      expect(c.lead_investor.length).toBeGreaterThan(0);
      expect(c.hq.length).toBeGreaterThan(0);
      const age = daysBetween(c.announced_on, FIXED_NOW);
      expect(age).toBeGreaterThanOrEqual(0);
      expect(age).toBeLessThanOrEqual(60);
    }
  });

  it("has at least 60 feedback items across at least 7 categories with mixed sentiment, severity, plan and channel", () => {
    const items = sim.feedback();
    expect(items.length).toBeGreaterThanOrEqual(60);
    expect(new Set(items.map((f) => f.id)).size).toBe(items.length);
    expect(new Set(items.map((f) => f.category)).size).toBeGreaterThanOrEqual(7);
    expect(new Set(items.map((f) => f.sentiment))).toEqual(new Set(["positive", "neutral", "negative"]));
    expect(new Set(items.map((f) => f.severity))).toEqual(new Set(["low", "medium", "high"]));
    expect(new Set(items.map((f) => f.plan)).size).toBe(3);
    expect(new Set(items.map((f) => f.channel)).size).toBe(4);
    for (const f of items) {
      expect(f.text.length).toBeGreaterThan(30);
      expect(daysBetween(f.received_on, FIXED_NOW)).toBeLessThanOrEqual(60);
    }
  });

  it("serves the three sample datasets raw (no ground-truth labels) and [] for unknown names", () => {
    const feedback = sim.dataset("customer_feedback");
    expect(feedback.length).toBeGreaterThanOrEqual(60);
    expect(Object.keys(feedback[0])).toEqual(["id", "customer", "plan", "channel", "received_on", "text"]);

    const tickets = sim.dataset("support_tickets");
    expect(tickets.length).toBeGreaterThanOrEqual(30);
    expect(tickets[0]).not.toHaveProperty("category");
    expect(tickets[0]).not.toHaveProperty("priority");
    expect(tickets[0]).toHaveProperty("subject");

    const rounds = sim.dataset("funding_rounds");
    expect(rounds).toEqual(sim.companies());

    expect(sim.dataset("Customer Feedback")).toEqual(feedback);
    expect(sim.dataset("nonexistent")).toEqual([]);
  });

  it("derives fixture dates from the clock at call time so the demo always looks fresh", () => {
    const later = createSimulation(() => new Date(FIXED_NOW.getTime() + 30 * DAY_MS));
    const before = sim.companies();
    const after = later.companies();
    for (let i = 0; i < before.length; i++) {
      expect(before[i].company).toBe(after[i].company);
      expect(daysBetween(before[i].announced_on, FIXED_NOW) - daysBetween(after[i].announced_on, FIXED_NOW)).toBeCloseTo(30, 5);
    }
    expect(later.feedback()[0].received_on > sim.feedback()[0].received_on).toBe(true);
  });
});

describe("seeded randomness", () => {
  it("hashSeed is stable and spreads similar strings apart", () => {
    expect(hashSeed("collector|AI Infra")).toBe(hashSeed("collector|AI Infra"));
    expect(hashSeed("a")).not.toBe(hashSeed("b"));
    expect(hashSeed("")).toBeGreaterThanOrEqual(0);
  });

  it("seededPick and seededShuffle are deterministic, and shuffle never mutates its input", () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    const copy = arr.slice();
    const a = seededShuffle(arr, 42);
    const b = seededShuffle(arr, 42);
    expect(a).toEqual(b);
    expect(arr).toEqual(copy);
    expect(a.slice().sort((x, y) => x - y)).toEqual(arr);
    expect(seededShuffle(arr, 43)).not.toEqual(a);
    expect(seededPick(arr, 7)).toBe(seededPick(arr, 7));
    expect(arr).toContain(seededPick(arr, 99));
    expect(() => seededPick([], 1)).toThrow();
  });
});
