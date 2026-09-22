import { CATEGORY_GROUPS, type CategoryGroup, type CompanyEntity } from "./fixtures/companies";
import { FEEDBACK_CATEGORIES } from "./fixtures/feedback";

/**
 * The simulated web's site map — shared by `search` (which links to these URLs) and `fetchPage` (which
 * serves them), so every search result is guaranteed to be fetchable.
 *
 *   news.example/funding/<slug>                 one funding article per company (= SimCompany.source_url)
 *   news.example/roundups/<id>                  roundups; every company appears in exactly two
 *   <slug>.example[/about]  ·  /pricing         company site + pricing page
 *   compare.example/pricing/<group>             pricing comparison per category group
 *   directory.example/ai-infrastructure/<group> company directory with leadership contacts (lead research)
 *   reviews.example/acme[/<category>]           customer feedback about the fictional "Acme" product
 *   anything else                               a plausible generic article
 */

export const NEWS_HOST = "news.example";
export const COMPARE_HOST = "compare.example";
export const DIRECTORY_HOST = "directory.example";
export const REVIEWS_HOST = "reviews.example";

export const urls = {
  article: (slug: string) => `https://${NEWS_HOST}/funding/${slug}`,
  roundup: (id: string) => `https://${NEWS_HOST}/roundups/${id}`,
  about: (slug: string) => `https://${slug}.example/about`,
  pricing: (slug: string) => `https://${slug}.example/pricing`,
  compare: (group: CategoryGroup) => `https://${COMPARE_HOST}/pricing/${group.replace("_", "-")}`,
  directory: (group: CategoryGroup) => `https://${DIRECTORY_HOST}/ai-infrastructure/${group.replace("_", "-")}`,
  reviews: (category?: string) => `https://${REVIEWS_HOST}/acme${category ? `/${category}` : ""}`,
};

export const GROUPS = Object.keys(CATEGORY_GROUPS) as CategoryGroup[];

export function groupFromSlug(slug: string): CategoryGroup | undefined {
  return GROUPS.find((g) => g.replace("_", "-") === slug);
}

export interface Roundup {
  id: string;
  url: string;
  title: string;
  intro: string;
  members: CompanyEntity[];
  /** Published the day its most recent round was announced. */
  publishedDaysAgo: number;
}

const CHRONO_TITLES: ReadonlyArray<(n: number) => string> = [
  (n) => `${n} AI infrastructure startups that raised this month`,
  (n) => `AI infra funding roundup: ${n} more rounds you may have missed`,
  (n) => `${n} AI infrastructure rounds from last month, ranked`,
  (n) => `Looking back: ${n} AI infrastructure raises from earlier this quarter`,
];

const GROUP_TITLES: Record<CategoryGroup, (n: number) => string> = {
  compute: (n) => `GPU clouds, training and edge: the ${n} compute startups investors just backed`,
  serving: (n) => `Inference, routing and fine-tuning: ${n} model-serving startups with fresh funding`,
  data: (n) => `Vector databases, labeling and synthetic data: ${n} AI data startups that raised recently`,
  trust_agents: (n) => `Agents, evals and AI security: ${n} startups that closed rounds this quarter`,
};

const ROUNDUP_SIZE = 12;

/**
 * Two complementary sets, so each company is in exactly one chronological roundup and one thematic roundup:
 * a broad query tends to surface the former, a category-focused query the latter.
 */
export function buildRoundups(companies: readonly CompanyEntity[]): Roundup[] {
  const out: Roundup[] = [];
  const byRecency = companies.slice().sort((a, b) => a.daysAgo - b.daysAgo);
  for (let i = 0, n = 0; i < byRecency.length; i += ROUNDUP_SIZE, n++) {
    const members = byRecency.slice(i, i + ROUNDUP_SIZE);
    const id = `ai-infrastructure-raises-${n + 1}`;
    const title = (CHRONO_TITLES[n] ?? CHRONO_TITLES[CHRONO_TITLES.length - 1])(members.length);
    out.push({
      id,
      url: urls.roundup(id),
      title,
      intro: `Capital keeps flowing into the picks and shovels of AI. Here are ${members.length} infrastructure rounds our newsroom tracked, newest first.`,
      members,
      publishedDaysAgo: Math.min(...members.map((m) => m.daysAgo)),
    });
  }
  for (const group of GROUPS) {
    const members = companies.filter((c) => c.group === group).sort((a, b) => b.amount_usd - a.amount_usd);
    if (members.length === 0) continue;
    const id = `${group.replace("_", "-")}-funding`;
    out.push({
      id,
      url: urls.roundup(id),
      title: GROUP_TITLES[group](members.length),
      intro: `${CATEGORY_GROUPS[group].label} is one of the busiest corners of AI infrastructure. These ${members.length} companies announced rounds in the last two months, largest first.`,
      members,
      publishedDaysAgo: Math.min(...members.map((m) => m.daysAgo)),
    });
  }
  return out;
}

export function isFeedbackCategory(value: string): boolean {
  return (FEEDBACK_CATEGORIES as readonly string[]).includes(value);
}
