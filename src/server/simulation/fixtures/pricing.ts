import { hashSeed, seededInt } from "../rng";

/**
 * Deterministic public pricing for the fictional companies — what a market-analysis worker finds on
 * "pricing pages". Shaped per category (GPU clouds bill per GPU-hour, vector DBs per month, …) and jittered
 * per company from a hash of its slug so competitors differ in believable ways.
 */

export interface PricingPlan {
  name: string;
  /** null = "contact sales". */
  price_usd: number | null;
  unit: string;
  includes: string;
}

export interface CompanyPricing {
  pricing_model: string;
  plans: PricingPlan[];
  starting_price_usd: number | null;
  free_tier: boolean;
  pricing_url: string;
}

interface PlanTemplate {
  name: string;
  /** Base price; jittered ±25%. null = custom. 0 = free. */
  base: number | null;
  unit: string;
  includes: string;
  /** Decimal places to keep after jitter (usage prices need cents, subscriptions don't). */
  decimals?: number;
}

interface CategoryTemplate {
  model: string;
  plans: PlanTemplate[];
}

const ENTERPRISE: PlanTemplate = { name: "Enterprise", base: null, unit: "custom contract", includes: "SSO, audit logs, private networking, dedicated support and volume discounts" };

const TEMPLATES: Record<string, CategoryTemplate> = {
  "GPU Cloud": {
    model: "Usage-based, per GPU-hour",
    plans: [
      { name: "On-Demand", base: 2.6, decimals: 2, unit: "per H100 GPU-hour", includes: "no commitment, per-second billing" },
      { name: "Reserved", base: 1.85, decimals: 2, unit: "per H100 GPU-hour", includes: "6-month commitment, guaranteed capacity" },
      ENTERPRISE,
    ],
  },
  "Training Orchestration": {
    model: "Platform fee plus managed GPU-hours",
    plans: [
      { name: "Team", base: 1200, unit: "per month", includes: "up to 64 GPUs under management, community support" },
      { name: "Scale", base: 4500, unit: "per month", includes: "up to 512 GPUs, priority scheduling, SLA" },
      ENTERPRISE,
    ],
  },
  "Edge AI": {
    model: "Per-device subscription",
    plans: [
      { name: "Developer", base: 0, unit: "per month", includes: "up to 10 devices, community support" },
      { name: "Fleet", base: 4, decimals: 2, unit: "per device per month", includes: "over-the-air updates, fleet analytics" },
      ENTERPRISE,
    ],
  },
  "Inference Platform": {
    model: "Usage-based, per million tokens",
    plans: [
      { name: "Developer", base: 0.45, decimals: 2, unit: "per 1M tokens (70B-class model)", includes: "shared endpoints, pay as you go" },
      { name: "Scale", base: 1500, unit: "per month platform fee", includes: "dedicated endpoints, discounted tokens, autoscaling controls" },
      ENTERPRISE,
    ],
  },
  "Model Gateway": {
    model: "Per-request platform fee",
    plans: [
      { name: "Free", base: 0, unit: "per month", includes: "up to 100k routed requests" },
      { name: "Pro", base: 0.2, decimals: 2, unit: "per 1k routed requests", includes: "semantic caching, spend limits, fallbacks" },
      ENTERPRISE,
    ],
  },
  "Fine-Tuning": {
    model: "Per training run plus hosting",
    plans: [
      { name: "Starter", base: 90, unit: "per fine-tuning run", includes: "models up to 8B parameters, shared hosting" },
      { name: "Growth", base: 900, unit: "per month", includes: "unlimited runs up to 8B, dedicated adapter hosting" },
      ENTERPRISE,
    ],
  },
  "Vector Database": {
    model: "Tiered subscription plus storage",
    plans: [
      { name: "Starter", base: 0, unit: "per month", includes: "1 project, up to 1M vectors" },
      { name: "Standard", base: 95, unit: "per month", includes: "50M vectors, hybrid search, daily backups" },
      ENTERPRISE,
    ],
  },
  "Data Labeling": {
    model: "Per-task pricing",
    plans: [
      { name: "Self-Serve", base: 0.08, decimals: 3, unit: "per labeled item", includes: "model-assisted labeling, consensus review" },
      { name: "Managed", base: 38, unit: "per expert annotator hour", includes: "vetted domain experts, quality audits" },
      ENTERPRISE,
    ],
  },
  "Synthetic Data": {
    model: "Per-dataset credits",
    plans: [
      { name: "Team", base: 750, unit: "per month", includes: "10M generated rows, privacy reports" },
      { name: "Business", base: 2800, unit: "per month", includes: "100M generated rows, on-prem connector" },
      ENTERPRISE,
    ],
  },
  "Evaluation & Observability": {
    model: "Per-seat subscription plus event volume",
    plans: [
      { name: "Free", base: 0, unit: "per month", includes: "2 seats, 50k traced events" },
      { name: "Team", base: 49, unit: "per seat per month", includes: "5M traced events, custom evaluators, alerts" },
      ENTERPRISE,
    ],
  },
  "Agent Infrastructure": {
    model: "Usage-based, per agent run-hour",
    plans: [
      { name: "Builder", base: 0, unit: "per month", includes: "100 agent run-hours, community support" },
      { name: "Production", base: 0.35, decimals: 2, unit: "per agent run-hour", includes: "durable state, approvals, 30-day replay" },
      ENTERPRISE,
    ],
  },
  "AI Security & Governance": {
    model: "Annual platform subscription",
    plans: [
      { name: "Growth", base: 1800, unit: "per month", includes: "up to 10M inspected requests, policy templates" },
      { name: "Business", base: 5200, unit: "per month", includes: "unlimited policies, SIEM export, compliance reports" },
      ENTERPRISE,
    ],
  },
};

const FALLBACK: CategoryTemplate = TEMPLATES["Evaluation & Observability"];

export function pricingFor(company: { slug: string; category: string }): CompanyPricing {
  const template = TEMPLATES[company.category] ?? FALLBACK;
  const plans = template.plans.map((p): PricingPlan => {
    if (p.base === null || p.base === 0) return { name: p.name, price_usd: p.base, unit: p.unit, includes: p.includes };
    // ±25% jitter, stable per (company, plan).
    const factor = seededInt(hashSeed(`${company.slug}|price|${p.name}`), 75, 125) / 100;
    const scale = 10 ** (p.decimals ?? 0);
    const price = Math.round(p.base * factor * scale) / scale;
    return { name: p.name, price_usd: price, unit: p.unit, includes: p.includes };
  });
  const paid = plans.filter((p): p is PricingPlan & { price_usd: number } => typeof p.price_usd === "number" && p.price_usd > 0);
  return {
    pricing_model: template.model,
    plans,
    starting_price_usd: paid.length > 0 ? paid[0].price_usd : null,
    free_tier: plans.some((p) => p.price_usd === 0),
    pricing_url: `https://${company.slug}.example/pricing`,
  };
}

export function describePlanPrice(plan: PricingPlan): string {
  if (plan.price_usd === null) return "custom pricing (contact sales)";
  if (plan.price_usd === 0) return "free";
  return `$${withThousands(plan.price_usd)} ${plan.unit}`;
}

/** Hand-rolled (no Intl) so page text is identical on every host. */
function withThousands(n: number): string {
  const [whole, fraction] = String(n).split(".");
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction ? `.${fraction}` : "");
}
