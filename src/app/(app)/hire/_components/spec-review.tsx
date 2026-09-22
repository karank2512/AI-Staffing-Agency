import { Ban, CheckCircle2, Lightbulb, ListChecks, Package, ShieldCheck, Wallet, Wrench } from "lucide-react";
import type { JobSpec } from "@/server/domain";
import type { ToolMeta } from "@/server/queries/hire";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatUsd, sentenceCase } from "@/lib/format";

const FORMAT_LABELS: Record<JobSpec["deliverable"]["format"], string> = {
  markdown: "Report (Markdown)",
  csv: "Spreadsheet (CSV)",
  json: "Structured data (JSON)",
};

const INPUT_SOURCE_LABELS: Record<JobSpec["inputs"][number]["source"], string> = {
  web: "Public web",
  provided_data: "Data you provide",
  user_instruction: "Your instructions",
  previous_runs: "Previous runs",
};

function BulletList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-1.5 text-sm">
      {items.map((item, i) => (
        <li key={`${i}-${item}`} className="flex gap-2.5">
          <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
          <span className="text-pretty">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function SectionTitle({ icon: Icon, children }: { icon: typeof Package; children: string }) {
  return (
    <CardTitle className="flex items-center gap-2">
      <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
      {children}
    </CardTitle>
  );
}

/**
 * The read-only half of the Job spec step: everything the scoper decided that the customer reviews but does not
 * edit inline (deliverable shape, success criteria, boundaries, tools, approvals, budget, assumptions).
 */
export function SpecReview({ spec, toolMeta }: { spec: JobSpec; toolMeta: Record<string, ToolMeta> }) {
  const { deliverable } = spec;
  const hasBudget = spec.budget.maxCostPerRunUsd !== undefined || spec.budget.maxMonthlyUsd !== undefined;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <CardHeader>
          <SectionTitle icon={Package}>Deliverable</SectionTitle>
          <CardDescription>What lands in your workspace after every run.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-muted/40 p-3">
            <div className="min-w-0">
              <p className="font-medium">{deliverable.title}</p>
              <p className="text-sm text-pretty text-muted-foreground">{deliverable.description}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{FORMAT_LABELS[deliverable.format]}</Badge>
              {deliverable.targetCount ? <Badge variant="outline" className="metric">~{deliverable.targetCount} records / run</Badge> : null}
            </div>
          </div>

          {deliverable.fields.length > 0 ? (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Field</TableHead>
                    <TableHead>What it holds</TableHead>
                    <TableHead className="w-24 text-right">Required</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deliverable.fields.map((field) => (
                    <TableRow key={field.name}>
                      <TableCell className="font-mono text-xs">{field.name}</TableCell>
                      <TableCell className="text-muted-foreground">{field.description}</TableCell>
                      <TableCell className="text-right">
                        {field.required ? <span className="text-emerald-600">Yes</span> : <span className="text-muted-foreground">Optional</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}

          {deliverable.sections.length > 0 ? (
            <div>
              <p className="eyebrow mb-2">Report sections</p>
              <ol className="flex flex-wrap gap-2">
                {deliverable.sections.map((section, i) => (
                  <li key={`${i}-${section}`} className="rounded-full border bg-background px-2.5 py-1 text-[13px]">
                    <span className="mr-1.5 text-muted-foreground tabular-nums">{i + 1}.</span>
                    {section}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionTitle icon={ListChecks}>Success criteria</SectionTitle>
          <CardDescription>How the work gets graded after each run.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {spec.successCriteria.map((criterion) => (
              <li key={criterion.id} className="flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-pretty">{criterion.description}</p>
                  {criterion.metric || criterion.target ? (
                    <p className="text-xs text-muted-foreground">
                      {criterion.metric ?? "Target"}
                      {criterion.target ? <span className="metric"> · {criterion.target}</span> : null}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionTitle icon={Ban}>Boundaries</SectionTitle>
          <CardDescription>Constraints the worker follows, and what it will not touch.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="eyebrow mb-2">Constraints</p>
            <BulletList items={spec.constraints} empty="No special constraints." />
          </div>
          <div>
            <p className="eyebrow mb-2">Out of scope</p>
            <BulletList items={spec.outOfScope} empty="Nothing explicitly excluded." />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionTitle icon={Wrench}>Tools likely needed</SectionTitle>
          <CardDescription>Granted to the worker on hire; you can tighten permissions later.</CardDescription>
        </CardHeader>
        <CardContent>
          {spec.toolsLikelyNeeded.length === 0 ? (
            <p className="text-sm text-muted-foreground">No external tools — this worker reasons over what it is given.</p>
          ) : (
            <ul className="divide-y">
              {spec.toolsLikelyNeeded.map((name) => {
                const meta = toolMeta[name];
                return (
                  <li key={name} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{meta?.displayName ?? sentenceCase(name)}</p>
                      <p className="text-xs text-pretty text-muted-foreground">{meta?.humanDescription ?? "Registered tool."}</p>
                    </div>
                    {meta?.defaultRequiresApproval ? (
                      <Badge variant="outline" className="shrink-0 border-amber-200 bg-amber-50 text-amber-800">
                        Approval required
                      </Badge>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionTitle icon={ShieldCheck}>Approval policy</SectionTitle>
          <CardDescription>Actions that pause the run until someone on your team says yes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <BulletList items={spec.approvalPolicy.requireApprovalFor} empty="Nothing needs sign-off — every run finishes on its own." />
          {spec.approvalPolicy.notes ? <p className="text-xs text-pretty text-muted-foreground">{spec.approvalPolicy.notes}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionTitle icon={Wallet}>Budget</SectionTitle>
          <CardDescription>Hard limits the platform enforces per run and per month.</CardDescription>
        </CardHeader>
        <CardContent>
          {hasBudget ? (
            <dl className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border bg-muted/40 p-3">
                <dt className="text-xs text-muted-foreground">Per run</dt>
                <dd className="text-lg font-semibold metric">{spec.budget.maxCostPerRunUsd !== undefined ? formatUsd(spec.budget.maxCostPerRunUsd) : "No cap"}</dd>
              </div>
              <div className="rounded-lg border bg-muted/40 p-3">
                <dt className="text-xs text-muted-foreground">Per month</dt>
                <dd className="text-lg font-semibold metric">{spec.budget.maxMonthlyUsd !== undefined ? formatUsd(spec.budget.maxMonthlyUsd) : "No cap"}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">No budget cap requested — the platform default of a few dollars per run applies.</p>
          )}
        </CardContent>
      </Card>

      {spec.inputs.length > 0 ? (
        <Card>
          <CardHeader>
            <SectionTitle icon={Package}>Inputs</SectionTitle>
            <CardDescription>What the worker reads to do the job.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {spec.inputs.map((input) => (
                <li key={input.name} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{input.name}</p>
                    <p className="text-xs text-pretty text-muted-foreground">{input.description}</p>
                  </div>
                  <Badge variant="outline" className="shrink-0">
                    {INPUT_SOURCE_LABELS[input.source]}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card className={spec.inputs.length > 0 ? undefined : "lg:col-span-2"}>
        <CardHeader>
          <SectionTitle icon={Lightbulb}>Assumptions</SectionTitle>
          <CardDescription>What we took as given. Edit the spec if any of these are wrong.</CardDescription>
        </CardHeader>
        <CardContent>
          <BulletList items={spec.assumptions} empty="No assumptions — everything came from your description." />
        </CardContent>
      </Card>
    </div>
  );
}
