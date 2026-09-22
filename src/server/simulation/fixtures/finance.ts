import { isoDaysAgo } from "../dates";

/**
 * Acme's spend over the last 30 days — the records a finance-ops worker reconciles or reviews: SaaS
 * subscription charges, vendor invoices and corporate-card spend. CLEARLY FICTIONAL vendors (every URL uses
 * `.example`). `flag` / `note` are GROUND TRUTH for the simulated reviewer: duplicate charges, idle seats,
 * overlapping tools, price increases, failed payments, over-threshold invoices and an unrecognized merchant.
 */

export type SpendGroup = "software" | "other";

export interface SimExpense {
  id: string;
  /** The vendor's invoice number, for invoice lines. */
  invoice_number: string | null;
  date: string; // ISO
  vendor: string;
  product: string;
  category: string;
  group: SpendGroup;
  kind: "subscription" | "invoice" | "card";
  amount_usd: number;
  billing_cycle: "monthly" | "annual" | "one-off";
  owner: string;
  team: string;
  seats: number | null;
  active_seats: number | null;
  renewal_date: string | null;
  payment_method: string;
  status: "paid" | "pending" | "failed" | "refunded";
  flag_reason: string | null;
  notes: string | null;
}

type Line = [
  daysAgo: number,
  vendor: string,
  product: string,
  category: string,
  kind: SimExpense["kind"],
  amount: number,
  cycle: SimExpense["billing_cycle"],
  owner: string,
  team: string,
  seats: number | null,
  activeSeats: number | null,
  renewsInDays: number | null,
  status: SimExpense["status"],
  flag?: string,
  note?: string,
];

const CARD = "Card •••• 4412";
const CARD_2 = "Card •••• 9087";
const INVOICE = "Invoice (net 30)";

// Oldest first; ids are assigned in this order. Software lines come first within each day for readability.
const LINES: Line[] = [
  [29, "Slatewise", "Docs & wiki", "Software: Collaboration", "subscription", 1240, "monthly", "Priya Iyer", "Operations", 62, 41, 41, "paid", "Only 41 of 62 seats active — 21 idle seats", "Downsize to ~45 seats at the next renewal (saves about $400/mo)"],
  [29, "Nimbus Mail", "Email & calendar", "Software: Collaboration", "subscription", 1860, "monthly", "Priya Iyer", "Operations", 124, 118, 33, "paid"],
  [28, "Pipewell CRM", "Sales CRM, Growth plan", "Software: Sales & CRM", "subscription", 2350, "monthly", "Marcus Vance", "Sales", 38, 35, 45, "paid"],
  [28, "Dialstream", "Sales calling", "Software: Sales & CRM", "subscription", 690, "monthly", "Marcus Vance", "Sales", 15, 6, 12, "paid", "Only 6 of 15 seats active — 9 idle seats", "Cut to 8 seats; usage has been flat for three months"],
  [27, "Gitforge", "Code hosting, Team plan", "Software: Engineering", "subscription", 1520, "monthly", "Elias Brandt", "Engineering", 76, 74, 51, "paid"],
  [27, "Tracebolt", "Error monitoring", "Software: Engineering", "subscription", 540, "monthly", "Elias Brandt", "Engineering", null, null, 51, "paid"],
  [26, "Cloudharbor", "Cloud hosting (compute + storage)", "Cloud infrastructure", "invoice", 18420, "monthly", "Elias Brandt", "Engineering", null, null, null, "paid", "Over the $5,000 approval threshold — PO on file (PO-2291)", "Up 6% vs last month, in line with traffic growth"],
  [26, "Boardly", "Whiteboarding", "Software: Design", "subscription", 480, "monthly", "Hana Moreau", "Product", 40, 22, 20, "paid", "Overlaps with Sketchwell — two whiteboarding tools", "Consolidate on one whiteboarding tool before either renews"],
  [25, "Sketchwell", "Whiteboarding & diagrams", "Software: Design", "subscription", 360, "monthly", "Hana Moreau", "Design", 30, 12, 64, "paid", "Overlaps with Boardly — two whiteboarding tools", "Consolidate on one whiteboarding tool before either renews"],
  [25, "Framecraft", "Design & prototyping", "Software: Design", "subscription", 1125, "monthly", "Hana Moreau", "Design", 25, 23, 58, "paid"],
  [24, "Helpline Desk", "Support helpdesk, Pro plan", "Software: Customer support", "subscription", 1416, "monthly", "Leila Haddad", "Support", 24, 24, 16, "paid", "Price up 18% vs last month ($1,200 → $1,416)", "Ask for the previous rate or a multi-year price lock before the renewal"],
  [24, "Chatlane", "Live chat widget", "Software: Customer support", "subscription", 299, "monthly", "Leila Haddad", "Support", 10, 9, 16, "paid"],
  [23, "Chartwell Analytics", "Product analytics", "Software: Data & analytics", "subscription", 890, "monthly", "Noor Qureshi", "Product", null, null, 38, "paid"],
  [23, "Chartwell Analytics", "Product analytics", "Software: Data & analytics", "subscription", 890, "monthly", "Noor Qureshi", "Product", null, null, 38, "paid", "Possible duplicate — same vendor, amount and day as the previous charge", "Ask Chartwell Analytics to refund the second charge"],
  [22, "Warehousely", "Data warehouse credits", "Software: Data & analytics", "invoice", 6250, "monthly", "Noor Qureshi", "Data", null, null, null, "pending", "Over the $5,000 approval threshold with no PO on file", "Raise a PO before paying; usage-based, so set a monthly cap"],
  [22, "Pipeflow ETL", "Data pipelines", "Software: Data & analytics", "subscription", 780, "monthly", "Noor Qureshi", "Data", null, null, 70, "paid"],
  [21, "Payscribe", "Payroll", "Software: HR & finance", "subscription", 1340, "monthly", "Ingrid Lindgren", "People", null, null, 150, "paid"],
  [21, "Peoplebase", "HR information system", "Software: HR & finance", "subscription", 980, "monthly", "Ingrid Lindgren", "People", 130, 126, 150, "paid"],
  [20, "Ledgerly Books", "Accounting", "Software: HR & finance", "subscription", 420, "monthly", "Tobias Eriksen", "Finance", 6, 6, 88, "paid"],
  [20, "Expenso", "Expense management", "Software: HR & finance", "subscription", 520, "monthly", "Tobias Eriksen", "Finance", 130, 57, 88, "paid", "Only 57 of 130 seats active — billed per seat", "Switch to active-user billing or trim seats to ~70"],
  [19, "Keyvault", "Password manager", "Software: Security", "subscription", 650, "monthly", "Rafael Serrano", "IT", 130, 127, 110, "paid"],
  [19, "Shieldpoint", "Endpoint security", "Software: Security", "subscription", 14400, "annual", "Rafael Serrano", "IT", 140, 128, 365, "paid", "Over the $5,000 approval threshold — PO on file (PO-2304)", "Annual renewal paid; next review in 12 months"],
  [18, "Signbright", "E-signatures", "Software: Legal & ops", "subscription", 310, "monthly", "Priya Iyer", "Operations", 12, 4, 27, "paid", "Only 4 of 12 seats active — 8 idle seats", "Downgrade to the 5-seat plan"],
  [18, "Formwell", "Forms & surveys", "Software: Marketing", "subscription", 95, "monthly", "Zara Okafor", "Marketing", 5, 5, 27, "paid"],
  [17, "Mailpost", "Email marketing", "Software: Marketing", "subscription", 1150, "monthly", "Zara Okafor", "Marketing", null, null, 43, "paid"],
  [17, "Adloom", "Social scheduling", "Software: Marketing", "subscription", 240, "monthly", "Zara Okafor", "Marketing", 6, 2, 43, "paid", "Only 2 of 6 seats active", "Drop to 2 seats"],
  [16, "Webflux", "Website CMS", "Software: Marketing", "subscription", 410, "monthly", "Zara Okafor", "Marketing", 8, 7, 82, "paid"],
  [16, "Meetbright", "Video meetings", "Software: Collaboration", "subscription", 1480, "monthly", "Priya Iyer", "Operations", 130, 119, 104, "paid"],
  [15, "Huddlepoint", "Video meetings", "Software: Collaboration", "subscription", 540, "monthly", "Marcus Vance", "Sales", 40, 11, 19, "paid", "Overlaps with Meetbright — two video-meeting tools", "Move Sales onto Meetbright and cancel before the renewal"],
  [15, "Taskline", "Project management", "Software: Collaboration", "subscription", 1360, "monthly", "Hana Moreau", "Product", 85, 81, 95, "paid"],
  [14, "Deploydeck", "CI/CD pipelines", "Software: Engineering", "subscription", 960, "monthly", "Elias Brandt", "Engineering", null, null, 51, "paid"],
  [14, "Flagpole", "Feature flags", "Software: Engineering", "subscription", 450, "monthly", "Elias Brandt", "Engineering", 30, 28, 51, "failed", "Card payment failed — service may be suspended", "Update the card on file today"],
  [13, "Logharbor", "Log management", "Software: Engineering", "subscription", 1210, "monthly", "Elias Brandt", "Engineering", null, null, 51, "paid"],
  [13, "Statuscast", "Status page", "Software: Engineering", "subscription", 79, "monthly", "Leila Haddad", "Support", null, null, 16, "paid"],
  [12, "QX*DIGITALSVCS 8841", "Unrecognized card charge", "Uncategorized", "card", 1180, "one-off", "Mei Tanaka", "Engineering", null, null, null, "paid", "Unrecognized merchant — confirm with the cardholder", "Ask Mei Tanaka for the receipt; dispute if unknown"],
  [12, "Transcribely", "Meeting transcription", "Software: Collaboration", "card", 300, "monthly", "Mei Tanaka", "Engineering", 10, 3, 17, "paid", "Bought on a personal-team card outside procurement", "Move to the company plan or cancel; overlaps with Meetbright's built-in notes"],
  [11, "Vendorwise", "Procurement & vendor management", "Software: Legal & ops", "subscription", 720, "monthly", "Tobias Eriksen", "Finance", 8, 8, 200, "paid"],
  [10, "Northfield Air", "Flights — sales offsite", "Travel", "card", 3240, "one-off", "Marcus Vance", "Sales", null, null, null, "paid"],
  [10, "Harbor Suites", "Hotel — sales offsite", "Travel", "card", 2860, "one-off", "Marcus Vance", "Sales", null, null, null, "paid"],
  [9, "Cloudharbor", "Cloud hosting credits (prepaid)", "Cloud infrastructure", "invoice", 5000, "one-off", "Elias Brandt", "Engineering", null, null, null, "paid"],
  [9, "Surveyloop", "NPS surveys", "Software: Customer support", "subscription", 199, "monthly", "Leila Haddad", "Support", null, null, 31, "refunded", undefined, "Refunded after we cancelled; confirm access is closed"],
  [8, "Brightdesk Coworking", "Coworking — London desks", "Office", "invoice", 2400, "monthly", "Priya Iyer", "Operations", null, null, null, "paid"],
  [7, "Codecraft Contractors", "Contract engineering (September)", "Contractors", "invoice", 9800, "one-off", "Elias Brandt", "Engineering", null, null, null, "pending", "Over the $5,000 approval threshold with no PO on file", "Raise a PO and match it to the signed SOW before paying"],
  [6, "Kitestack Events", "Conference booth — DevSummit", "Events", "invoice", 4500, "one-off", "Zara Okafor", "Marketing", null, null, null, "paid"],
  [5, "Adsprout", "Paid search ads", "Marketing", "card", 3900, "one-off", "Zara Okafor", "Marketing", null, null, null, "paid"],
  [4, "Pipewell CRM", "Sales CRM add-on seats", "Software: Sales & CRM", "subscription", 310, "monthly", "Marcus Vance", "Sales", 5, 1, 45, "paid", "4 of 5 add-on seats unused since purchase", "Remove the unused add-on seats"],
  [3, "Deskmate Supplies", "Office supplies", "Office", "card", 185, "one-off", "Priya Iyer", "Operations", null, null, null, "paid"],
  [2, "Snippetly", "Code snippets & docs", "Software: Engineering", "card", 144, "monthly", "Mei Tanaka", "Engineering", 12, 5, 26, "paid", "Overlaps with Slatewise — a second docs tool", "Fold into Slatewise"],
  [1, "Warehousely", "Data warehouse credits (top-up)", "Software: Data & analytics", "invoice", 2100, "one-off", "Noor Qureshi", "Data", null, null, null, "pending", "Second warehouse charge this month (+$2,100)", "Check for runaway queries; set a spend alert"],
];

export function expenseItems(now: Date): SimExpense[] {
  return LINES.map(([daysAgo, vendor, product, category, kind, amount, cycle, owner, team, seats, activeSeats, renewsInDays, status, flag, note], i) => ({
    id: `TXN-${4001 + i}`,
    invoice_number: kind === "invoice" ? `INV-${7101 + i}` : null,
    date: isoDaysAgo(daysAgo, now),
    vendor,
    product,
    category,
    group: category.startsWith("Software") ? "software" : "other",
    kind,
    amount_usd: amount,
    billing_cycle: cycle,
    owner,
    team,
    seats,
    active_seats: activeSeats,
    renewal_date: renewsInDays === null ? null : isoDaysAgo(-renewsInDays, now),
    payment_method: kind === "invoice" ? INVOICE : i % 5 === 3 ? CARD_2 : CARD,
    status,
    flag_reason: flag ?? null,
    notes: note ?? null,
  }));
}
