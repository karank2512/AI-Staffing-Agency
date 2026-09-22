import type { ReactNode } from "react";
import { CalendarClock, Coins, FileText, ShieldCheck, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EMPTY, formatUsd, pluralize, titleCase } from "@/lib/format";
import { describeCadence, type JobSpec } from "@/server/domain";

const FORMAT_WORDS: Record<JobSpec["deliverable"]["format"], string> = {
  markdown: "Written report",
  csv: "CSV file",
  json: "JSON records",
};

/** One labelled fact in the key-facts strip. */
function Fact({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border bg-muted/40 px-3 py-2.5">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <p className="eyebrow">{label}</p>
        <p className="truncate text-sm font-medium text-foreground">{value}</p>
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
      {children}
    </div>
  );
}

function Bullets({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-foreground/90 marker:text-muted-foreground/60">
      {items.map((item, i) => (
        <li key={`${i}-${item.slice(0, 24)}`}>{item}</li>
      ))}
    </ul>
  );
}

function budgetText(budget: JobSpec["budget"]): string {
  const parts: string[] = [];
  if (budget.maxCostPerRunUsd) parts.push(`${formatUsd(budget.maxCostPerRunUsd)} per run`);
  if (budget.maxMonthlyUsd) parts.push(`${formatUsd(budget.maxMonthlyUsd)} per month`);
  return parts.length > 0 ? parts.join(" · ") : "No cap set";
}

/**
 * Human-readable, read-only rendering of the approved JobSpec — the "job description" a manager signed off on.
 * The hire flow has its own editable presentation; this one never mutates.
 */
export function SpecView({ spec, versionLabel }: { spec: JobSpec; versionLabel?: string }) {
  const { deliverable } = spec;
  const fineprint = [
    { title: "Constraints", items: spec.constraints },
    { title: "Out of scope", items: spec.outOfScope },
    { title: "Assumptions", items: spec.assumptions },
  ].filter((group) => group.items.length > 0);

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex flex-wrap items-center gap-2">
          <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
          {spec.title}
          {versionLabel ? (
            <Badge variant="outline" className="font-normal text-muted-foreground">
              {versionLabel}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>{spec.summary}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Fact icon={<CalendarClock className="size-4" aria-hidden="true" />} label="Cadence" value={describeCadence(spec.cadence)} />
          <Fact
            icon={<FileText className="size-4" aria-hidden="true" />}
            label="Deliverable"
            value={`${FORMAT_WORDS[deliverable.format]}${deliverable.targetCount ? ` · ~${pluralize(deliverable.targetCount, "record")}` : ""}`}
          />
          <Fact icon={<Coins className="size-4" aria-hidden="true" />} label="Budget" value={budgetText(spec.budget)} />
          <Fact
            icon={<ShieldCheck className="size-4" aria-hidden="true" />}
            label="Needs your approval"
            value={spec.approvalPolicy.requireApprovalFor.length > 0 ? spec.approvalPolicy.requireApprovalFor.join("; ") : "Nothing — fully autonomous"}
          />
        </div>

        <Block title="Objective">
          <p className="text-sm text-pretty text-foreground/90">{spec.objective}</p>
        </Block>

        <Block title="Responsibilities">
          <Bullets items={spec.responsibilities} empty="No responsibilities listed." />
        </Block>

        <Block title={`Deliverable: ${deliverable.title}`}>
          <p className="text-sm text-pretty text-foreground/90">{deliverable.description}</p>
          {deliverable.sections.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-xs text-muted-foreground">Sections:</span>
              {deliverable.sections.map((section) => (
                <Badge key={section} variant="secondary" className="font-normal">
                  {section}
                </Badge>
              ))}
            </div>
          ) : null}
          {deliverable.fields.length > 0 ? (
            <div className="mt-2 overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="pl-3">Field</TableHead>
                    <TableHead>What it holds</TableHead>
                    <TableHead className="pr-3 text-right">Required</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deliverable.fields.map((field) => (
                    <TableRow key={field.name}>
                      <TableCell className="pl-3 font-medium">{titleCase(field.name)}</TableCell>
                      <TableCell className="whitespace-normal text-muted-foreground">{field.description}</TableCell>
                      <TableCell className="pr-3 text-right text-muted-foreground">{field.required ? "Yes" : "Optional"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </Block>

        <Block title="How success is measured">
          <ul className="space-y-1.5">
            {spec.successCriteria.map((criterion) => (
              <li key={criterion.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-sm">
                <span className="text-foreground/90">{criterion.description}</span>
                {criterion.metric || criterion.target ? (
                  <span className="metric text-xs text-muted-foreground">
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
            <ul className="space-y-1 text-sm">
              {spec.inputs.map((input) => (
                <li key={input.name} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-foreground">{input.name}</span>
                  <span className="text-muted-foreground">
                    {input.description} · {titleCase(input.source)}
                    {input.required ? "" : " · optional"}
                  </span>
                </li>
              ))}
            </ul>
          </Block>
        ) : null}

        <Block title="Tools they'll likely use">
          {spec.toolsLikelyNeeded.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {spec.toolsLikelyNeeded.map((tool) => (
                <Badge key={tool} variant="outline" className="gap-1 font-normal">
                  <Wrench aria-hidden="true" />
                  {titleCase(tool)}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{EMPTY}</p>
          )}
        </Block>

        {fineprint.length > 0 || spec.approvalPolicy.notes ? (
          <details className="group rounded-lg border bg-muted/30 px-3 py-2">
            <summary className="cursor-pointer text-[13px] font-medium text-muted-foreground select-none group-open:text-foreground">
              Constraints, scope and assumptions
            </summary>
            <div className="mt-3 space-y-4 pb-1">
              {fineprint.map((group) => (
                <Block key={group.title} title={group.title}>
                  <Bullets items={group.items} empty={EMPTY} />
                </Block>
              ))}
              {spec.approvalPolicy.notes ? (
                <Block title="Approval notes">
                  <p className="text-sm text-muted-foreground">{spec.approvalPolicy.notes}</p>
                </Block>
              ) : null}
            </div>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
