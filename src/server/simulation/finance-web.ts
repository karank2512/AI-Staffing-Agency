import type { SimPage, SimSearchResult } from "@/server/simulation/types";
import { FINANCE_HOST, urls } from "./catalog";
import { isoDaysAgo, isoNoon, longDate } from "./dates";
import { expenseItems, type SimExpense } from "./fixtures/finance";
import { stem, tokenize } from "./text";

/**
 * The finance corner of the simulated web: Acme's own spend ledger, as a finance-ops worker would open it from
 * the billing system. Each line states its facts in one sentence keyed by its TXN id, which is what
 * `extractRecords` reads. Search sends spend / invoice / subscription queries here instead of to customer reviews.
 */

export const FINANCE_TERMS: ReadonlySet<string> = new Set([
  "spend", "spending", "expense", "invoice", "transaction", "subscription", "saa", "saas", "ledger", "reconcile", "reconciliation",
  "receipt", "payable", "billing", "reimbursement", "procurement", "renewal", "license", "licence", "seat", "vendor", "card", "budget",
]);

type Ledger = "spend" | "saas" | "invoices";

const LEDGERS: Record<Ledger, { title: string; intro: string; filter: (e: SimExpense) => boolean }> = {
  spend: {
    title: "Acme spend ledger — last 30 days",
    intro: "Every card charge, subscription and vendor invoice posted to Acme's books in the last 30 days, oldest first. Amounts in USD.",
    filter: () => true,
  },
  saas: {
    title: "Acme SaaS subscriptions — charges, seats and renewals",
    intro: "Software subscriptions charged in the last 30 days, with seat utilization, owner and next renewal. Amounts in USD.",
    filter: (e) => e.group === "software",
  },
  invoices: {
    title: "Acme vendor invoices — last 30 days",
    intro: "Vendor invoices received in the last 30 days with approval status. The approval threshold is $5,000 and requires a PO.",
    filter: (e) => e.kind === "invoice",
  },
};

/** "$18,420.00" — formatted by hand (no Intl) so page text is identical on every host. */
function money(n: number): string {
  const [whole, cents] = n.toFixed(2).split(".");
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents}`;
}

export function expenseLine(e: SimExpense): string {
  const parts = [
    `${e.id} · ${e.date} · ${e.vendor} — ${e.product} (${e.category}) · ${money(e.amount_usd)} · ${e.billing_cycle === "one-off" ? "one-off" : `${e.billing_cycle} ${e.kind}`} · ${e.invoice_number ? `invoice ${e.invoice_number}` : e.payment_method}`,
    `owner: ${e.owner} (${e.team})`,
  ];
  if (e.seats !== null && e.active_seats !== null) parts.push(`${e.active_seats} of ${e.seats} seats active`);
  if (e.renewal_date) parts.push(`renews ${e.renewal_date}`);
  parts.push(`status: ${e.status}`);
  if (e.flag_reason) parts.push(`flag: ${e.flag_reason}`);
  if (e.notes) parts.push(`note: ${e.notes}`);
  return `${parts.join(" · ")}.`;
}

export function financePage(ledger: string, now: Date): SimPage | null {
  const def = LEDGERS[ledger as Ledger];
  if (!def) return null;
  const items = expenseItems(now).filter(def.filter);
  const total = items.reduce((sum, e) => sum + e.amount_usd, 0);
  const flagged = items.filter((e) => e.flag_reason).length;
  const text = [
    `${def.intro} ${items.length} lines totalling ${money(total)}; ${flagged} flagged for review. Exported ${longDate(isoDaysAgo(0, now))}.`,
    ...items.map(expenseLine),
  ].join("\n\n");
  return { url: urls.finance(ledger), title: def.title, text };
}

const GUIDES: ReadonlyArray<{ slug: string; title: string; snippet: string }> = [
  { slug: "saas-spend-review", title: "How to run a monthly SaaS spend review", snippet: "Find idle seats, overlapping tools and surprise price increases before they renew — a checklist for finance and IT." },
  { slug: "card-reconciliation", title: "Corporate card reconciliation: a practical playbook", snippet: "Match every charge to a receipt and an owner, flag duplicates and unknown merchants, and close the month on time." },
  { slug: "approval-thresholds", title: "Setting spend approval thresholds that people follow", snippet: "Why a PO requirement above a fixed amount catches most surprises, and how to keep it lightweight." },
];

export function financeResults(query: string, limit: number, now: Date): SimSearchResult[] {
  const terms = new Set(tokenize(query).map(stem));
  const wantsSaas = ["saas", "saa", "software", "subscription", "seat", "license", "licence", "tool", "renewal"].some((t) => terms.has(t));
  const wantsInvoices = ["invoice", "payable", "bill", "vendor"].some((t) => terms.has(t));
  const order: Ledger[] = wantsSaas ? ["saas", "spend", "invoices"] : wantsInvoices ? ["invoices", "spend", "saas"] : ["spend", "saas", "invoices"];
  const ledgers = order.map((ledger): SimSearchResult => {
    const page = financePage(ledger, now);
    return {
      title: LEDGERS[ledger].title,
      url: urls.finance(ledger),
      snippet: page ? page.text.split("\n\n")[0] : LEDGERS[ledger].intro,
      source: FINANCE_HOST,
      publishedAt: isoNoon(isoDaysAgo(0, now)),
    };
  });
  const guides = GUIDES.map((g, i): SimSearchResult => ({
    title: g.title,
    url: `https://handbook.example/finance/${g.slug}`,
    snippet: g.snippet,
    source: "handbook.example",
    publishedAt: isoNoon(isoDaysAgo(12 + i * 9, now)),
  }));
  return [...ledgers, ...guides].slice(0, limit);
}
