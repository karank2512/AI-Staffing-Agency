import type { SampleDataset } from "@/server/tools/schemas";
import { companyEntities, toSimCompany } from "./fixtures/companies";
import { feedbackItems } from "./fixtures/feedback";
import { ticketItems } from "./fixtures/tickets";

/**
 * Built-in sample datasets behind `read_dataset` (SAMPLE_DATASETS in tools/schemas.ts).
 *
 * customer_feedback and support_tickets are served RAW — the way an export from a helpdesk or survey tool
 * looks — i.e. WITHOUT the ground-truth labels (category / sentiment / severity / priority / team). Working
 * those out is the worker's job; `simulation.feedback()` exposes the labelled items for seeds and tests.
 */

type Row = Record<string, unknown>;

const LOADERS: Record<SampleDataset, (now: Date) => Row[]> = {
  customer_feedback: (now) =>
    feedbackItems(now).map((f) => ({ id: f.id, customer: f.customer, plan: f.plan, channel: f.channel, received_on: f.received_on, text: f.text })),
  funding_rounds: (now) => companyEntities(now).map((c) => ({ ...toSimCompany(c) })),
  support_tickets: (now) =>
    ticketItems(now).map((t) => ({
      id: t.id,
      subject: t.subject,
      body: t.body,
      customer: t.customer,
      plan: t.plan,
      channel: t.channel,
      created_on: t.created_on,
      status: t.status,
    })),
};

export function dataset(name: string, now: Date): Row[] {
  const key = name.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const loader = Object.prototype.hasOwnProperty.call(LOADERS, key) ? LOADERS[key as SampleDataset] : undefined;
  return loader ? loader(now) : [];
}
