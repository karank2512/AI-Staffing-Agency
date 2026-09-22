import { describePlanPrice, isMonthlyUnit, monthlyPriceOf, type CompanyPricing, type PricingPlan } from "./fixtures/pricing";
import { hashSeed, seededInt, seededPick } from "./rng";

/**
 * Pricing facts a competitor-pricing spec asks for beyond the list price — seat minimums, "what changed since last
 * time" and the monthly figure — derived deterministically from (vendor slug, plan) so the same row always reads
 * the same, run after run and host after host.
 */

type Facts = Record<string, unknown>;

/** Enterprise contracts start at a seat floor; per-seat plans sometimes need a few; everything else is a single account. */
export function seatMinimum(slug: string, plan: PricingPlan): number {
  const seed = hashSeed(`${slug}|seats|${plan.name}`);
  if (plan.price_usd === null) return seededPick([10, 20, 25, 50, 100], seed);
  if (/\bseat\b/i.test(plan.unit) && plan.price_usd > 0) return seededPick([1, 1, 2, 3, 5], seed);
  return 1;
}

const PAID_CHANGES = ["No change", "No change", "No change", "No change", "No change", "Price up 10%", "Price up 20%", "Price down 5%", "New plan since last check"];
const FREE_CHANGES = ["No change", "No change", "No change", "No change", "Free tier limits reduced", "Free tier now includes more usage"];
const CUSTOM_CHANGES = ["No change", "No change", "No change", "No change", "Now requires an annual contract"];

/** "No change" most weeks; now and then a price move — never a price move on a free or contact-sales plan. */
export function changeSinceLast(slug: string, plan: PricingPlan): string {
  const pool = plan.price_usd === null ? CUSTOM_CHANGES : plan.price_usd === 0 ? FREE_CHANGES : PAID_CHANGES;
  return seededPick(pool, hashSeed(`${slug}|change|${plan.name}`));
}

/** Open roles scale with team size (4–14% of headcount, at least one); vendors without a headcount get 5–60. */
export function openRoles(slug: string, employees: number | null): number {
  const seed = hashSeed(`${slug}|open-roles`);
  if (employees === null || employees <= 0) return seededInt(seed, 5, 60);
  return Math.max(1, Math.round((employees * seededInt(seed, 4, 14)) / 100));
}

/** What a reader needs when the monthly column is empty: why (usage-based / custom) and the real unit. */
export function planNote(plan: PricingPlan): string {
  if (plan.price_usd === null) return "Custom pricing — contact sales.";
  if (plan.price_usd > 0 && !isMonthlyUnit(plan.unit)) return `Usage-based: ${describePlanPrice(plan)}; no monthly list price.`;
  return `${describePlanPrice(plan)} — ${plan.includes}.`;
}

export function planPricingFacts(slug: string, plan: PricingPlan): Facts {
  return {
    plan: plan.name,
    starting_price_usd: plan.price_usd,
    monthly_price_usd: monthlyPriceOf(plan),
    price_unit: plan.unit,
    plan_includes: plan.includes,
    seat_minimum: seatMinimum(slug, plan),
    change_since_last: changeSinceLast(slug, plan),
    notes: planNote(plan),
  };
}

/** Vendor-level view: the entry paid plan decides the unit, seat floor and change; monthly = cheapest monthly paid plan. */
export function companyPricingFacts(slug: string, pricing: CompanyPricing): Facts {
  const entry = pricing.plans.find((p) => typeof p.price_usd === "number" && p.price_usd > 0) ?? pricing.plans[0];
  const monthly = pricing.plans.map(monthlyPriceOf).filter((p): p is number => p !== null && p > 0);
  return {
    pricing_model: pricing.pricing_model,
    starting_price_usd: pricing.starting_price_usd,
    monthly_price_usd: monthly.length > 0 ? Math.min(...monthly) : null,
    // Read by fields.buildRecord only when a requested monthly-price column comes back empty.
    monthly_price_note: monthly.length > 0 || !entry ? null : planNote(entry),
    price_unit: entry?.unit ?? null,
    free_tier: pricing.free_tier,
    plans: pricing.plans.map((p) => p.name).join(", "),
    pricing_url: pricing.pricing_url,
    seat_minimum: entry ? seatMinimum(slug, entry) : null,
    change_since_last: entry ? changeSinceLast(slug, entry) : "No change",
  };
}
