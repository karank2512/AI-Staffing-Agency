import type { SimPage } from "@/server/simulation/types";
import { COMPARE_HOST, DIRECTORY_HOST, NEWS_HOST, REVIEWS_HOST, buildRoundups, groupFromSlug, isFeedbackCategory, urls, type Roundup } from "./catalog";
import { longDate } from "./dates";
import { CATEGORY_GROUPS, companyEntities, type CategoryGroup, type CompanyEntity } from "./fixtures/companies";
import { feedbackItems } from "./fixtures/feedback";
import { companyPeople, investorPartner } from "./fixtures/people";
import { describePlanPrice, pricingFor } from "./fixtures/pricing";
import { genericPage } from "./pages-generic";
import { hashSeed, seededInt, seededPick } from "./rng";
import { formatUsdShort, titleCase } from "./text";

/**
 * `fetchPage` — the simulated web. Pages state their facts in ordinary sentences (the way a news article
 * would) so that `extractRecords` has something real to read. NEVER throws: unknown or malformed URLs get a
 * plausible generic page, exactly like fetching an unfamiliar site.
 */

const USE_OF_FUNDS: Record<CategoryGroup, readonly string[]> = {
  compute: [
    "expand data-center capacity and bring new GPU regions online",
    "double its cluster footprint and hire site-reliability engineers",
    "secure next-generation accelerators and grow its enterprise sales team",
  ],
  serving: [
    "grow its engineering team and cut latency for enterprise customers",
    "launch dedicated deployments in Europe and Asia",
    "expand model coverage and invest in its developer platform",
  ],
  data: [
    "scale its data operations and ship new enterprise compliance features",
    "expand its managed service and deepen integrations with the modern data stack",
    "grow its research team and open a second engineering hub",
  ],
  trust_agents: [
    "expand its go-to-market team and build out enterprise controls",
    "open-source more of its core runtime and grow its developer community",
    "accelerate product development and hire across engineering and customer success",
  ],
};

const PAIN_BY_CATEGORY: Record<string, string> = {
  "GPU Cloud": "getting reliable GPU capacity at a sane price",
  "Training Orchestration": "wasting expensive GPUs on failed or badly scheduled jobs",
  "Edge AI": "getting capable models to run where the data actually lives",
  "Inference Platform": "serving models fast enough without burning the budget",
  "Model Gateway": "juggling providers, keys and costs across a dozen models",
  "Fine-Tuning": "turning a general model into one that actually knows their domain",
  "Vector Database": "keeping retrieval fast and relevant as their data grows",
  "Data Labeling": "getting high-quality labeled data without an army of contractors",
  "Synthetic Data": "finding enough clean, usable data to train on",
  "Evaluation & Observability": "not knowing whether their AI features are actually working",
  "Agent Infrastructure": "getting agents out of the demo and into production safely",
  "AI Security & Governance": "proving to security and legal that their AI stack is under control",
};

const INVESTOR_QUOTES = [
  "This is the kind of unglamorous infrastructure every serious AI team ends up needing.",
  "We spoke to dozens of customers and heard the same thing: they would be in real trouble without it.",
  "The team has shipped more in eighteen months than most companies do in five years.",
  "Infrastructure winners are decided early, and the usage numbers here speak for themselves.",
] as const;

function articlePage(c: CompanyEntity): SimPage {
  const { ceo } = companyPeople(c.slug, c.group);
  const amount = formatUsdShort(c.amount_usd);
  const partner = investorPartner(c.lead_investor);
  const useOfFunds = seededPick(USE_OF_FUNDS[c.group], hashSeed(`${c.slug}|funds`));
  const pain = PAIN_BY_CATEGORY[c.category] ?? "shipping AI features reliably";
  const text = [
    `${c.company}, a ${c.hq}-based ${c.category.toLowerCase()} startup, has raised ${amount} in ${c.stage} funding led by ${c.lead_investor}. The round was announced on ${longDate(c.announced_on)}.`,
    `${c.description} The company employs about ${c.employees} people and says it will use the new capital to ${useOfFunds}.`,
    `"Every team building with AI hits the same wall: ${pain}. We built ${c.company} so they never have to think about it again," said ${ceo.name}, co-founder and CEO of ${c.company}.`,
    `${partner}, a partner at ${c.lead_investor}, will join the ${c.company} board. "${seededPick(INVESTOR_QUOTES, hashSeed(`${c.slug}|iq`))}"`,
    `Deal summary — Company: ${c.company} · Category: ${c.category} · Stage: ${c.stage} · Amount: ${amount} (USD ${c.amount_usd}) · Lead investor: ${c.lead_investor} · Headquarters: ${c.hq} · Website: ${c.website}`,
  ].join("\n\n");
  return { url: c.source_url, title: `${c.company} raises ${amount} ${c.stage} to scale its ${c.category.toLowerCase()} business`, text };
}

function roundupPage(r: Roundup): SimPage {
  const entries = r.members.map(
    (c, i) =>
      `${i + 1}. ${c.company} — ${formatUsdShort(c.amount_usd)} ${c.stage} (${c.category}). ${c.description} Led by ${c.lead_investor}; based in ${c.hq}. Announced ${longDate(c.announced_on)}. Source: ${c.source_url}`,
  );
  const total = r.members.reduce((sum, c) => sum + c.amount_usd, 0);
  const text = [r.intro, ...entries, `Together these ${r.members.length} companies raised ${formatUsdShort(total)}.`].join("\n\n");
  return { url: r.url, title: r.title, text };
}

function aboutPage(c: CompanyEntity, url: string): SimPage {
  const people = companyPeople(c.slug, c.group);
  const founded = 2019 + seededInt(hashSeed(`${c.slug}|founded`), 0, 4);
  const text = [
    `About ${c.company}. ${c.description}`,
    `Founded in ${founded}, ${c.company} is headquartered in ${c.hq} and has a team of about ${c.employees}. We work in ${c.category.toLowerCase()} and serve AI teams from early-stage startups to large enterprises.`,
    `Leadership: ${people.ceo.name}, ${people.ceo.title} (${people.ceo.email}) · ${people.cto.name}, ${people.cto.title} (${people.cto.email}) · ${people.buyer.name}, ${people.buyer.title} (${people.buyer.email}).`,
    `Latest news: ${c.company} raised a ${formatUsdShort(c.amount_usd)} ${c.stage} led by ${c.lead_investor}, announced on ${longDate(c.announced_on)}. Read more at ${c.source_url}.`,
    `We're hiring across engineering, solutions and customer success. Pricing is published at ${urls.pricing(c.slug)}.`,
  ].join("\n\n");
  return { url, title: `About ${c.company} — ${c.category}`, text };
}

function planLines(c: CompanyEntity): string[] {
  // The "<Company> <Plan> plan:" phrasing is what extractRecords keys plan-level rows on.
  return pricingFor(c).plans.map((p) => `${c.company} ${p.name} plan: ${describePlanPrice(p)} — ${p.includes}.`);
}

function pricingPage(c: CompanyEntity, url: string): SimPage {
  const pricing = pricingFor(c);
  const text = [
    `${c.company} pricing. ${c.description}`,
    `Pricing model: ${pricing.pricing_model}. ${pricing.free_tier ? "A free tier is available." : "There is no free tier; trials are available on request."}`,
    ...planLines(c),
    `All prices in USD, billed monthly unless stated. Volume discounts and annual commitments are available on the Enterprise plan. Questions? Contact sales@${c.slug}.example.`,
  ].join("\n\n");
  return { url, title: `Pricing — ${c.company}`, text };
}

function comparePage(group: CategoryGroup, companies: readonly CompanyEntity[]): SimPage {
  const members = companies.filter((c) => c.group === group).sort((a, b) => a.company.localeCompare(b.company));
  const blocks = members.map((c) => {
    const pricing = pricingFor(c);
    return [`${c.company} (${c.category}) — pricing model: ${pricing.pricing_model}.`, ...planLines(c), `Pricing page: ${pricing.pricing_url}`].join("\n");
  });
  const text = [
    `How ${members.length} vendors in ${CATEGORY_GROUPS[group].label.toLowerCase()} price their products. We reviewed each public pricing page; list prices are in USD and exclude negotiated discounts.`,
    ...blocks,
    `Takeaway: usage-based pricing dominates this segment, and nearly every vendor keeps its Enterprise tier behind a sales conversation.`,
  ].join("\n\n");
  return { url: urls.compare(group), title: `Pricing compared: ${CATEGORY_GROUPS[group].label}`, text };
}

function directoryPage(group: CategoryGroup, companies: readonly CompanyEntity[]): SimPage {
  const members = companies.filter((c) => c.group === group).sort((a, b) => a.company.localeCompare(b.company));
  const entries = members.map((c) => {
    const { buyer } = companyPeople(c.slug, c.group);
    return `${c.company} — ${c.category}. ${c.description} HQ: ${c.hq}. Team size: about ${c.employees}. Last round: ${formatUsdShort(c.amount_usd)} ${c.stage} (${longDate(c.announced_on)}). Key contact: ${buyer.name}, ${buyer.title} (${buyer.email}). Website: ${c.website}`;
  });
  const text = [`Directory of ${members.length} recently funded companies in ${CATEGORY_GROUPS[group].label.toLowerCase()}, with leadership contacts.`, ...entries].join("\n\n");
  return { url: urls.directory(group), title: `${CATEGORY_GROUPS[group].label} — company directory`, text };
}

function reviewsPage(category: string | undefined, now: Date): SimPage {
  const all = feedbackItems(now);
  const items = category ? all.filter((f) => f.category === category) : all.slice(0, 16);
  const counts = new Map<string, number>();
  for (const f of all) counts.set(f.category, (counts.get(f.category) ?? 0) + 1);
  const intro = category
    ? `What Acme customers are saying about ${category}: ${items.length} recent comments collected from support conversations, NPS surveys, app reviews and sales calls.`
    : `Recent customer feedback about Acme across ${counts.size} themes (${[...counts.entries()].map(([k, v]) => `${k}: ${v}`).join(", ")}). Showing the ${items.length} most recent comments.`;
  const entries = items.map((f) => `Review ${f.id} · ${f.customer} (${f.plan} plan) via ${f.channel} on ${longDate(f.received_on)}: "${f.text}"`);
  return {
    url: urls.reviews(category),
    title: category ? `Acme customer feedback — ${titleCase(category)}` : "Acme customer feedback — latest reviews",
    text: [intro, ...entries].join("\n\n"),
  };
}

function parseUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  for (const candidate of [trimmed, `https://${trimmed}`]) {
    try {
      const u = new URL(candidate);
      if (u.hostname) return u;
    } catch {
      // try the next form
    }
  }
  return null;
}

export function fetchPage(url: string, now: Date): SimPage {
  const parsed = parseUrl(url);
  if (!parsed) return genericPage(url, now);
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const segments = parsed.pathname.split("/").filter(Boolean).map((s) => s.toLowerCase());
  const companies = companyEntities(now);

  if (host === NEWS_HOST && segments[0] === "funding") {
    const company = companies.find((c) => c.slug === segments[1]);
    if (company) return articlePage(company);
  }
  if (host === NEWS_HOST && segments[0] === "roundups") {
    const roundup = buildRoundups(companies).find((r) => r.id === segments[1]);
    if (roundup) return roundupPage(roundup);
  }
  if (host === COMPARE_HOST && segments[0] === "pricing") {
    const group = groupFromSlug(segments[1] ?? "");
    if (group) return comparePage(group, companies);
  }
  if (host === DIRECTORY_HOST) {
    const group = groupFromSlug(segments[segments.length - 1] ?? "");
    if (group) return directoryPage(group, companies);
  }
  if (host === REVIEWS_HOST && segments[0] === "acme") {
    if (!segments[1]) return reviewsPage(undefined, now);
    if (isFeedbackCategory(segments[1])) return reviewsPage(segments[1], now);
  }
  const owner = companies.find((c) => host === `${c.slug}.example`);
  if (owner) return segments[0] === "pricing" ? pricingPage(owner, url) : aboutPage(owner, url);

  return genericPage(url, now);
}
