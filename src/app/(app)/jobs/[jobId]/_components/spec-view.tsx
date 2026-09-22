import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EMPTY, formatUsd, pluralize, titleCase } from "@/lib/format";
import { describeCadence, type JobSpec } from "@/server/domain";

const FORMAT_WORDS: Record<JobSpec["deliverable"]["format"], string> = {
  markdown: "Written report",
  csv: "CSV file",
  json: "JSON records",
};

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10 first:mt-0">
      <h3 className="text-[17px] leading-[1.35] font-semibold tracking-[-0.022em]">{title}</h3>
      <div className="mt-2.5 space-y-3 text-[17px] leading-[1.6] text-pretty">{children}</div>
    </section>
  );
}

function Bullets({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-muted-foreground">{empty}</p>;
  return (
    <ul className="list-disc space-y-2 pl-6 marker:text-tertiary">
      {items.map((item, i) => (
        <li key={`${i}-${item.slice(0, 24)}`}>{item}</li>
      ))}
    </ul>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-3 last:border-0 sm:flex-row sm:items-baseline sm:gap-6">
      <dt className="w-48 shrink-0 text-footnote text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-[15px] text-pretty">{value}</dd>
    </div>
  );
}

function budgetText(budget: JobSpec["budget"]): string {
  const parts: string[] = [];
  if (budget.maxCostPerRunUsd) parts.push(`${formatUsd(budget.maxCostPerRunUsd)} per run`);
  if (budget.maxMonthlyUsd) parts.push(`${formatUsd(budget.maxMonthlyUsd)} per month`);
  return parts.length > 0 ? parts.join(" · ") : "No cap set";
}

/**
 * The approved JobSpec as the document a manager signed off on: one title, a lead paragraph, a short table of
 * the facts that matter, then plain prose sections. Read-only — the hire flow owns the editable version.
 */
export function SpecView({ spec, versionLabel }: { spec: JobSpec; versionLabel?: string }) {
  const { deliverable } = spec;
  const fineprint = [
    { title: "Constraints", items: spec.constraints },
    { title: "Out of scope", items: spec.outOfScope },
    { title: "Assumptions", items: spec.assumptions },
  ].filter((group) => group.items.length > 0);

  return (
    <Card className="py-9 sm:py-12">
      <CardContent className="w-full max-w-[692px]">
        <header>
          <h2 className="text-title-2 text-balance">{spec.title}</h2>
          {versionLabel ? <p className="mt-1 text-footnote text-muted-foreground">{versionLabel}</p> : null}
          <p className="text-body-lg mt-4 text-pretty text-muted-foreground">{spec.summary}</p>
        </header>

        <dl className="mt-8 border-t border-border">
          <Fact label="Cadence" value={describeCadence(spec.cadence)} />
          <Fact
            label="Deliverable"
            value={`${FORMAT_WORDS[deliverable.format]}${deliverable.targetCount ? ` · about ${pluralize(deliverable.targetCount, "record")}` : ""}`}
          />
          <Fact label="Budget" value={budgetText(spec.budget)} />
          <Fact
            label="Needs your approval"
            value={
              spec.approvalPolicy.requireApprovalFor.length > 0
                ? spec.approvalPolicy.requireApprovalFor.join("; ")
                : "Nothing — this one runs on its own"
            }
          />
        </dl>

        <Block title="Objective">
          <p>{spec.objective}</p>
        </Block>

        <Block title="Responsibilities">
          <Bullets items={spec.responsibilities} empty="No responsibilities listed." />
        </Block>

        <Block title={`Deliverable: ${deliverable.title}`}>
          <p>{deliverable.description}</p>
          {deliverable.sections.length > 0 ? (
            <p className="text-[15px] text-muted-foreground">Sections: {deliverable.sections.join(", ")}.</p>
          ) : null}
          {deliverable.fields.length > 0 ? (
            <dl className="border-t border-border pt-1">
              {deliverable.fields.map((field) => (
                <div key={field.name} className="flex flex-col gap-0.5 border-b border-border py-3 last:border-0 sm:flex-row sm:gap-6">
                  <dt className="w-48 shrink-0 text-[15px] font-medium">{titleCase(field.name)}</dt>
                  <dd className="min-w-0 text-[15px] text-pretty text-muted-foreground">
                    {field.description}
                    {field.required ? "" : " · optional"}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </Block>

        <Block title="How success is measured">
          <ul className="space-y-2.5">
            {spec.successCriteria.map((criterion) => (
              <li key={criterion.id} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                <span className="min-w-0">{criterion.description}</span>
                {criterion.metric || criterion.target ? (
                  <span className="metric shrink-0 text-footnote text-muted-foreground">
                    {criterion.metric ?? "Target"}
                    {criterion.target ? ` · ${criterion.target}` : ""}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Block>

        {spec.inputs.length > 0 ? (
          <Block title="Works from">
            <ul className="space-y-2">
              {spec.inputs.map((input) => (
                <li key={input.name}>
                  <span className="font-medium">{input.name}</span>
                  <span className="text-muted-foreground">
                    {" — "}
                    {input.description} · {titleCase(input.source)}
                    {input.required ? "" : " · optional"}
                  </span>
                </li>
              ))}
            </ul>
          </Block>
        ) : null}

        <Block title="Tools they’ll likely use">
          <p className={spec.toolsLikelyNeeded.length > 0 ? undefined : "text-muted-foreground"}>
            {spec.toolsLikelyNeeded.length > 0 ? spec.toolsLikelyNeeded.map((t) => titleCase(t)).join(", ") : EMPTY}
          </p>
        </Block>

        {fineprint.length > 0 || spec.approvalPolicy.notes ? (
          <details className="group/fine mt-10 border-t border-border">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[15px] font-medium select-none [&::-webkit-details-marker]:hidden">
              Constraints, scope and assumptions
              <ChevronDown
                className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-[240ms] ease-standard group-open/fine:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <div className="pb-2">
              {fineprint.map((group) => (
                <Block key={group.title} title={group.title}>
                  <Bullets items={group.items} empty={EMPTY} />
                </Block>
              ))}
              {spec.approvalPolicy.notes ? (
                <Block title="Approval notes">
                  <p className="text-muted-foreground">{spec.approvalPolicy.notes}</p>
                </Block>
              ) : null}
            </div>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
