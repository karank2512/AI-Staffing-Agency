import type { SimFeedbackItem } from "@/server/simulation/types";
import { isoDaysAgo } from "../dates";

/**
 * 64 pieces of customer feedback about a fictional B2B analytics product ("Acme"), 8 per category.
 * category / sentiment / severity are the GROUND TRUTH the simulated categorizer "discovers"; the raw
 * dataset served to `read_dataset` deliberately omits them (see datasets.ts).
 */

type Plan = SimFeedbackItem["plan"];
type Channel = SimFeedbackItem["channel"];
type Sentiment = SimFeedbackItem["sentiment"];
type Severity = SimFeedbackItem["severity"];
type Row = [customer: string, plan: Plan, channel: Channel, sentiment: Sentiment, severity: Severity, text: string];

export const FEEDBACK_CATEGORIES = [
  "onboarding",
  "performance",
  "pricing",
  "integrations",
  "reliability",
  "reporting",
  "mobile",
  "support",
] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

const BY_CATEGORY: Record<FeedbackCategory, Row[]> = {
  onboarding: [
    ["Brightpath Logistics", "pro", "support", "negative", "high", "Setup took our ops team almost two weeks because the import wizard kept rejecting our CSV headers. We nearly gave up before a support rep sent us a template."],
    ["Nimbus Retail", "pro", "nps", "positive", "low", "The guided checklist on day one was great. We had our first dashboard live in under an hour."],
    ["Fernhill Dental Group", "free", "app_review", "negative", "medium", "Inviting teammates is confusing. Half my team landed in the wrong workspace and I had to re-invite them one by one."],
    ["Castellan Insurance", "enterprise", "sales_call", "neutral", "medium", "The onboarding call was helpful but the docs it pointed to were out of date. Screenshots don't match the current UI."],
    ["Orchard Street Capital", "enterprise", "support", "negative", "high", "SSO setup needed three back-and-forth emails with your team. A self-serve SAML guide would have saved us a week."],
    ["Kitewood Studios", "free", "nps", "positive", "low", "Loved the sample data workspace. It let me show my boss the value before we connected anything real."],
    ["Marlowe Freight", "pro", "support", "negative", "high", "The product tour skips role permissions entirely. We accidentally gave interns admin access."],
    ["Pinecrest Academy", "pro", "nps", "neutral", "low", "Took a while to understand the difference between projects and workspaces, but once it clicked things were smooth."],
  ],
  performance: [
    ["Holloway Manufacturing", "enterprise", "support", "negative", "high", "Dashboards with more than ten widgets take 20+ seconds to load. My team has started screenshotting them instead of opening the app."],
    ["Nimbus Retail", "pro", "nps", "positive", "low", "Search is noticeably faster since the last release. Thank you for fixing that."],
    ["Quarry Lane Foods", "pro", "support", "negative", "high", "The app freezes whenever I filter a report by a custom date range longer than 90 days."],
    ["Castellan Insurance", "enterprise", "support", "negative", "high", "Exports of large tables time out. Anything over 50k rows just spins forever."],
    ["Tessellate Health", "enterprise", "nps", "neutral", "medium", "Generally snappy, but the Monday-morning slowdown is real. Pages crawl between 9 and 10am Eastern."],
    ["Brightpath Logistics", "pro", "app_review", "negative", "medium", "Bulk editing 200 records at once locks the browser tab for a full minute."],
    ["Juniper & Pine", "pro", "nps", "positive", "low", "Page loads feel instant on the new dashboard builder. Big improvement over last year."],
    ["Vantage Couriers", "enterprise", "sales_call", "negative", "medium", "Real-time widgets lag a few minutes behind our source data, which makes them hard to trust during incidents."],
  ],
  pricing: [
    ["Fernhill Dental Group", "pro", "sales_call", "negative", "medium", "The jump from Pro to Enterprise is steep. We only need SSO, not the whole enterprise bundle."],
    ["Marlowe Freight", "pro", "nps", "negative", "high", "Per-seat pricing punishes us for adding occasional viewers. A read-only seat type would keep us from churning."],
    ["Kitewood Studios", "pro", "nps", "positive", "low", "Pricing is fair for what we get. We replaced two tools with this one."],
    ["Quarry Lane Foods", "pro", "support", "negative", "high", "We were surprised by an overage charge for API calls. The usage page didn't warn us we were close to the limit."],
    ["Pinecrest Academy", "pro", "sales_call", "neutral", "low", "The annual discount is nice but we'd like a quarterly billing option for cash-flow reasons."],
    ["Lowell Bike Co", "free", "app_review", "negative", "medium", "Free tier limits are too tight to evaluate properly. Three dashboards isn't enough to test a real workflow."],
    ["Harbor Youth Alliance", "pro", "nps", "positive", "low", "The non-profit discount made this possible for us. Thank you."],
    ["Orchard Street Capital", "enterprise", "sales_call", "negative", "high", "Your competitor quoted us 30% less for a similar seat count. We need a reason to stay at renewal."],
  ],
  integrations: [
    ["Vantage Couriers", "enterprise", "support", "negative", "high", "The Salesforce sync drops custom fields every few days and we have to re-map them manually."],
    ["Juniper & Pine", "pro", "nps", "positive", "low", "Slack alerts are the feature my team uses most. Simple and reliable."],
    ["Lowell Bike Co", "pro", "app_review", "negative", "medium", "We need a native HubSpot integration. The Zapier workaround breaks whenever a field name changes."],
    ["Tessellate Health", "enterprise", "support", "neutral", "medium", "The REST API is well documented but there are no webhooks for report completion, so we poll every minute."],
    ["Holloway Manufacturing", "enterprise", "support", "negative", "high", "The Google Sheets connector silently stops refreshing after the OAuth token expires. No email, no banner."],
    ["Castellan Insurance", "enterprise", "nps", "positive", "low", "Snowflake connector setup took ten minutes. Best data-source onboarding we've had with any vendor."],
    ["Pinecrest Academy", "pro", "nps", "neutral", "medium", "Would love a Microsoft Teams integration. Half our company isn't on Slack."],
    ["Brightpath Logistics", "pro", "support", "negative", "medium", "The Jira integration only syncs one way. Status changes in Jira never show up in our dashboards."],
  ],
  reliability: [
    ["Orchard Street Capital", "enterprise", "support", "negative", "high", "Two outages in one month during our reporting window. Leadership is asking whether we can depend on this tool."],
    ["Tessellate Health", "enterprise", "support", "negative", "high", "Scheduled reports sometimes just don't send. No error, nothing in the logs. We found out when the CFO asked where her Monday email was."],
    ["Nimbus Retail", "pro", "nps", "positive", "low", "Uptime has been rock solid for us this year."],
    ["Kitewood Studios", "pro", "app_review", "negative", "medium", "Lost unsaved dashboard edits twice this week when the session expired without warning."],
    ["Vantage Couriers", "enterprise", "support", "negative", "high", "The status page said all systems operational while logins were failing for an hour."],
    ["Holloway Manufacturing", "enterprise", "support", "negative", "high", "A data refresh failed silently overnight and our morning numbers were stale. An alert on failed refreshes is a must."],
    ["Marlowe Freight", "pro", "support", "neutral", "low", "Occasional 502 errors when saving filters, maybe once a week. A retry always works."],
    ["Castellan Insurance", "enterprise", "nps", "positive", "low", "Appreciated the transparent post-mortem after the last incident. That's how you keep trust."],
  ],
  reporting: [
    ["Juniper & Pine", "pro", "sales_call", "negative", "high", "We can't schedule a report to go to external clients without buying them a seat. That blocks our main use case."],
    ["Quarry Lane Foods", "pro", "support", "negative", "medium", "PDF exports cut off wide tables. We end up pasting screenshots into slides."],
    ["Orchard Street Capital", "enterprise", "nps", "positive", "low", "The new cohort chart is exactly what we needed for board reporting."],
    ["Fernhill Dental Group", "pro", "app_review", "negative", "medium", "There's no way to add a calculated column without exporting to Excel. Basic formulas would go a long way."],
    ["Harbor Youth Alliance", "pro", "nps", "positive", "low", "Report templates saved us hours. Would love more of them for finance teams."],
    ["Tessellate Health", "enterprise", "support", "negative", "medium", "Filters on shared reports reset every time someone else opens the link. Very confusing for executives."],
    ["Lowell Bike Co", "pro", "app_review", "neutral", "low", "Drill-down works well, but there's no way to go back up a level without starting over."],
    ["Holloway Manufacturing", "enterprise", "sales_call", "negative", "high", "We need row-level permissions in reports. Right now regional managers can see each other's numbers."],
  ],
  mobile: [
    ["Marlowe Freight", "pro", "app_review", "negative", "medium", "The iOS app logs me out every single day. I've stopped using it."],
    ["Kitewood Studios", "pro", "app_review", "negative", "medium", "Charts are unreadable on a phone. Legends overlap the data and you can't pinch to zoom."],
    ["Vantage Couriers", "enterprise", "nps", "positive", "low", "Push notifications for threshold alerts are great. I catch issues before I'm at my desk."],
    ["Pinecrest Academy", "pro", "app_review", "negative", "low", "There's no Android tablet layout. The app just stretches the phone UI."],
    ["Nimbus Retail", "pro", "nps", "neutral", "low", "The mobile app is fine for viewing but I can't even leave a comment on a dashboard."],
    ["Brightpath Logistics", "pro", "support", "negative", "high", "The app crashes on launch since the last update on Android 14. Reinstalling didn't help."],
    ["Quarry Lane Foods", "pro", "sales_call", "neutral", "medium", "Offline mode would be huge for our field team. Warehouses have terrible signal."],
    ["Juniper & Pine", "pro", "app_review", "positive", "low", "Face ID login is quick and the home screen widgets are a nice touch."],
  ],
  support: [
    ["Orchard Street Capital", "enterprise", "support", "negative", "high", "Waited four days for a reply on a billing question. For what we pay, that's not acceptable."],
    ["Castellan Insurance", "enterprise", "nps", "positive", "low", "Your support team went above and beyond. They recorded a custom walkthrough for our analysts."],
    ["Vantage Couriers", "enterprise", "support", "negative", "medium", "Chat support is only available in US hours. Our team in Manila is on their own."],
    ["Lowell Bike Co", "free", "app_review", "negative", "low", "The help center search never finds the article I need, even when I know it exists."],
    ["Fernhill Dental Group", "pro", "support", "negative", "medium", "Got passed between three agents and had to re-explain the problem each time."],
    ["Harbor Youth Alliance", "pro", "nps", "positive", "low", "Fast, friendly answers every time I've reached out. Keep it up."],
    ["Holloway Manufacturing", "enterprise", "sales_call", "negative", "medium", "Our dedicated success manager left and nobody told us. We found out when the quarterly review never got scheduled."],
    ["Pinecrest Academy", "pro", "nps", "positive", "low", "The community forum is active and I usually get an answer from another user within the hour."],
  ],
};

/** What a product team would typically do about each theme — used for `suggested_action`-style fields. */
export const FEEDBACK_ACTIONS: Record<FeedbackCategory, { action: string; team: string }> = {
  onboarding: { action: "Tighten the first-run setup flow and refresh the getting-started docs", team: "Growth" },
  performance: { action: "Profile slow dashboards and exports; set a load-time budget", team: "Platform Engineering" },
  pricing: { action: "Review packaging (viewer seats, SSO add-on) and add usage warnings before overages", team: "Pricing & Packaging" },
  integrations: { action: "Harden connector syncs and surface token-expiry and sync-failure alerts", team: "Integrations" },
  reliability: { action: "Add alerting for failed schedules and refreshes; review incident communication", team: "Site Reliability" },
  reporting: { action: "Prioritise external sharing, row-level permissions and export fidelity", team: "Reporting" },
  mobile: { action: "Fix session persistence and crash-on-launch; improve chart rendering on small screens", team: "Mobile" },
  support: { action: "Reduce first-response time and extend support-hour coverage", team: "Customer Support" },
};

interface FeedbackFixture extends Omit<SimFeedbackItem, "received_on"> {
  daysAgo: number;
}

/**
 * Authored grouped by category for readability; the day offsets interleave the categories so any
 * "most recent N" slice still spans several themes.
 */
const FEEDBACK_FIXTURES: readonly FeedbackFixture[] = FEEDBACK_CATEGORIES.flatMap((category, c) =>
  BY_CATEGORY[category].map(([customer, plan, channel, sentiment, severity, text], i) => {
    const n = c * 8 + i;
    return { id: `FB-${1001 + n}`, customer, plan, channel, text, category, sentiment, severity, daysAgo: 1 + ((n * 13) % 45) };
  }),
);

/** Most recent first. */
export function feedbackItems(now: Date): SimFeedbackItem[] {
  return FEEDBACK_FIXTURES.slice()
    .sort((a, b) => a.daysAgo - b.daysAgo || a.id.localeCompare(b.id))
    .map(({ daysAgo, ...item }) => ({ ...item, received_on: isoDaysAgo(daysAgo, now) }));
}
