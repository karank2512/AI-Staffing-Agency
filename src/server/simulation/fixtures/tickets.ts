import { isoDaysAgo } from "../dates";

/**
 * 32 inbound support tickets for the same fictional product as the feedback fixtures.
 * category / priority / sentiment / team are GROUND TRUTH for simulated triage; the raw dataset omits them.
 */

export interface SimTicket {
  id: string;
  subject: string;
  body: string;
  customer: string;
  plan: "free" | "pro" | "enterprise";
  channel: "email" | "chat" | "phone" | "web_form";
  created_on: string; // ISO date
  status: "open" | "pending" | "solved";
  category: string;
  priority: "low" | "normal" | "high" | "urgent";
  sentiment: "positive" | "neutral" | "negative";
  team: string;
}

type Row = [
  subject: string,
  customer: string,
  plan: SimTicket["plan"],
  channel: SimTicket["channel"],
  status: SimTicket["status"],
  priority: SimTicket["priority"],
  sentiment: SimTicket["sentiment"],
  body: string,
];

export const TICKET_CATEGORIES = [
  "billing",
  "bug",
  "how_to",
  "account_access",
  "integration",
  "feature_request",
  "outage",
  "data_export",
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_ROUTING: Record<TicketCategory, { team: string; action: string }> = {
  billing: { team: "Billing", action: "Verify the invoice history and reply with the correction or refund timeline" },
  bug: { team: "Engineering", action: "Reproduce, attach steps and logs, and file with the owning squad" },
  how_to: { team: "Customer Success", action: "Reply with the relevant help-center guide and offer a short walkthrough" },
  account_access: { team: "Security", action: "Verify identity, restore or revoke access, and confirm the audit trail" },
  integration: { team: "Integrations", action: "Check connector logs and re-authorise or re-map the affected sync" },
  feature_request: { team: "Product", action: "Log the request with account context and share the roadmap status" },
  outage: { team: "Site Reliability", action: "Escalate to the on-call engineer and link the status-page incident" },
  data_export: { team: "Customer Success", action: "Run a managed export and confirm the delivery format and deadline" },
};

const BY_CATEGORY: Record<TicketCategory, Row[]> = {
  billing: [
    ["Charged twice for our March invoice", "Marlowe Freight", "pro", "email", "open", "high", "negative", "We were billed twice for our March subscription. The invoices ending 4471 and 4472 show the same amount. Please refund the duplicate as soon as possible."],
    ["Update billing contact and VAT number", "Borough & Finch Architects", "pro", "web_form", "pending", "normal", "neutral", "Our finance lead has changed. Please update the billing contact and add our VAT number to future invoices."],
    ["Downgrade from Enterprise to Pro at renewal", "Pinecrest Academy", "enterprise", "email", "open", "normal", "neutral", "Our renewal is next month and we'd like to move down to Pro. What do we lose and how do we schedule the change?"],
    ["Refund request for unused seats", "Lowell Bike Co", "pro", "chat", "solved", "normal", "negative", "We removed six users in January but were still charged for them in February. Can we get a credit?"],
  ],
  bug: [
    ["Dashboard widgets are blank after the latest update", "Holloway Manufacturing", "enterprise", "email", "open", "high", "negative", "Since this morning every widget on our Operations dashboard renders as an empty card. Other dashboards are fine. Hard refresh doesn't help."],
    ["Date filter returns the wrong week for Sydney time zone", "Vantage Couriers", "enterprise", "web_form", "pending", "normal", "neutral", "With the workspace time zone set to Sydney, 'This week' starts on Sunday evening UTC and includes last week's data."],
    ["CSV import duplicates rows with special characters", "Quarry Lane Foods", "pro", "email", "open", "high", "negative", "Any row with an ampersand or accent in the product name gets imported twice. We now have hundreds of duplicates to clean up."],
    ["Saved views disappear after logout", "Kitewood Studios", "pro", "chat", "open", "normal", "negative", "I save a filtered view, log out, and when I come back it's gone. Happens every time on Chrome."],
    ["Chart tooltip shows NaN for zero values", "Nimbus Retail", "pro", "web_form", "solved", "low", "neutral", "Minor one: hovering a bar with a value of zero shows 'NaN%' in the tooltip."],
  ],
  how_to: [
    ["How do I share a dashboard with a client who has no account?", "Juniper & Pine", "pro", "chat", "solved", "low", "neutral", "We'd like to send a live dashboard to a client without buying them a seat. Is there a public link option?"],
    ["Setting up weekly email digests", "Harbor Youth Alliance", "pro", "email", "solved", "low", "positive", "Love the product. Could you point me to how to schedule a Monday-morning digest for our board?"],
    ["Can I clone a workspace for a new region?", "Brightpath Logistics", "pro", "chat", "pending", "low", "neutral", "We're opening a Canadian office and want the same dashboards with a different data source. What's the quickest way?"],
    ["Best way to model multi-currency revenue", "Orchard Street Capital", "enterprise", "email", "open", "normal", "neutral", "We report in USD but book in EUR and GBP. Is there a recommended approach to conversion inside reports?"],
  ],
  account_access: [
    ["Locked out after enabling two-factor authentication", "Fernhill Dental Group", "pro", "phone", "open", "urgent", "negative", "I turned on 2FA, lost my phone the same day, and now I can't get in. I'm the only admin on the account."],
    ["Former employee still has admin access", "Castellan Insurance", "enterprise", "email", "open", "high", "negative", "Someone who left us three weeks ago still appears as an active admin. We need this removed and an audit of their recent activity."],
    ["SSO login loop with our identity provider", "Tessellate Health", "enterprise", "email", "pending", "high", "negative", "After yesterday's certificate rotation, users are bounced between the login page and our identity provider endlessly."],
    ["Password reset email never arrives", "Lowell Bike Co", "free", "web_form", "solved", "normal", "neutral", "I've requested a reset four times and nothing arrives, not even in spam."],
  ],
  integration: [
    ["Salesforce sync failing with a field integrity error", "Vantage Couriers", "enterprise", "email", "open", "high", "negative", "The nightly Salesforce sync has failed three nights running with a field integrity exception on the Opportunity object."],
    ["Slack alerts posting to the wrong channel", "Juniper & Pine", "pro", "chat", "solved", "normal", "neutral", "Threshold alerts are going to #general instead of #ops-alerts even though the settings page shows the right channel."],
    ["Webhook retries are flooding our endpoint", "Tessellate Health", "enterprise", "email", "open", "high", "negative", "When our endpoint returned a 500 for a few minutes, your webhooks retried hundreds of times a minute. Is there a backoff?"],
    ["Google Sheets connector stuck on Refreshing", "Nimbus Retail", "pro", "web_form", "pending", "normal", "neutral", "One of our Sheets sources has shown 'Refreshing' for two days. Other sources update normally."],
  ],
  feature_request: [
    ["Request: dark mode for wall-mounted dashboards", "Holloway Manufacturing", "enterprise", "web_form", "open", "low", "neutral", "Our factory-floor screens are blinding at night. A dark theme for TV mode would be very welcome."],
    ["Request: row-level permissions in shared reports", "Castellan Insurance", "enterprise", "email", "open", "normal", "neutral", "Regional managers should only see their own region's rows. Is this on the roadmap?"],
    ["Request: export dashboards to slides", "Kitewood Studios", "pro", "chat", "open", "low", "positive", "We rebuild our monthly deck by hand from screenshots. A slide export would save us a day a month."],
    ["Request: audit log API", "Orchard Street Capital", "enterprise", "email", "pending", "normal", "neutral", "Our compliance team wants to pull audit events into our SIEM. Is there an API for the audit log?"],
  ],
  outage: [
    ["Cannot load any dashboards - 503 errors", "Orchard Street Capital", "enterprise", "phone", "open", "urgent", "negative", "Every page returns a 503 since about 8:40am. We have a board meeting at 10 and need the numbers."],
    ["Scheduled reports did not send this morning", "Tessellate Health", "enterprise", "email", "open", "urgent", "negative", "None of our 7am scheduled reports arrived today. Nothing in the delivery log either."],
    ["Login page timing out for the whole team", "Marlowe Freight", "pro", "chat", "solved", "urgent", "negative", "Nobody on our team can log in; the page spins and then times out. The status page says everything is fine."],
  ],
  data_export: [
    ["Export of 80k rows times out", "Quarry Lane Foods", "pro", "email", "open", "high", "negative", "We need a full export of our orders table for an audit, but anything over about 50k rows fails."],
    ["Full data export needed for compliance audit by Friday", "Castellan Insurance", "enterprise", "email", "open", "high", "neutral", "Our auditors have asked for a complete export of all report definitions and access logs by end of week."],
    ["Exported PDF is missing the last page", "Pinecrest Academy", "pro", "web_form", "pending", "normal", "neutral", "When I export the term summary to PDF, the final page with totals is cut off."],
    ["Deletion request for a former user's personal data", "Borough & Finch Architects", "pro", "email", "open", "high", "neutral", "A former employee has asked us to erase their personal data. Please confirm how we remove it from your systems and backups."],
  ],
};

interface TicketFixture extends Omit<SimTicket, "created_on"> {
  daysAgo: number;
}

const TICKET_FIXTURES: readonly TicketFixture[] = (() => {
  const out: TicketFixture[] = [];
  let n = 0;
  for (const category of TICKET_CATEGORIES) {
    for (const [subject, customer, plan, channel, status, priority, sentiment, body] of BY_CATEGORY[category]) {
      out.push({
        id: `TCK-${2001 + n}`,
        subject,
        body,
        customer,
        plan,
        channel,
        status,
        category,
        priority,
        sentiment,
        team: TICKET_ROUTING[category].team,
        daysAgo: (n * 7) % 20,
      });
      n++;
    }
  }
  return out;
})();

/** Newest first. */
export function ticketItems(now: Date): SimTicket[] {
  return TICKET_FIXTURES.slice()
    .sort((a, b) => a.daysAgo - b.daysAgo || a.id.localeCompare(b.id))
    .map(({ daysAgo, ...t }) => ({ ...t, created_on: isoDaysAgo(daysAgo, now) }));
}
