import { Fragment } from "react";
import { ArrowRight, Bot, Cog, Lightbulb, ShieldAlert, Wrench } from "lucide-react";
import type { BlueprintComponent, WorkerProposal } from "@/server/domain";
import type { ToolMeta } from "@/server/queries/hire";
import { RelativeTime } from "@/components/relative-time";
import { SimulatedBadge } from "@/components/simulated-badge";
import { WorkerAvatar } from "@/components/worker-avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDate, sentenceCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MODEL_TIER_LABELS, operationLabel } from "../schema";

const TIER_CLASSES = {
  fast: "border-sky-200 bg-sky-50 text-sky-700",
  standard: "border-violet-200 bg-violet-50 text-violet-700",
  reasoning: "border-indigo-200 bg-indigo-50 text-indigo-700",
} as const;

function PipelineStep({ component, toolMeta }: { component: BlueprintComponent; toolMeta: Record<string, ToolMeta> }) {
  const isAgent = component.type === "agent";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <li
          tabIndex={0}
          className={cn(
            "flex w-44 shrink-0 cursor-help flex-col gap-2 rounded-lg border p-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            isAgent ? "border-primary/20 bg-primary/5" : "bg-muted/40",
          )}
        >
          <div className="flex items-center gap-2">
            <span className={cn("flex size-6 items-center justify-center rounded-md ring-1 ring-inset", isAgent ? "bg-primary/10 text-primary ring-primary/20" : "bg-background text-muted-foreground ring-foreground/10")}>
              {isAgent ? <Bot className="size-3.5" aria-hidden="true" /> : <Cog className="size-3.5" aria-hidden="true" />}
            </span>
            <span className="eyebrow">{isAgent ? "AI step" : "Automated"}</span>
          </div>
          <p className="truncate text-sm font-medium" title={component.name}>
            {component.name}
          </p>
          <div className="flex flex-wrap gap-1">
            {isAgent ? (
              <Badge variant="outline" className={cn("h-4.5 px-1.5 text-[10px]", TIER_CLASSES[component.modelTier])}>
                {MODEL_TIER_LABELS[component.modelTier]}
              </Badge>
            ) : (
              <Badge variant="outline" className="h-4.5 px-1.5 text-[10px]">
                {operationLabel(component.operation)}
              </Badge>
            )}
            {isAgent && component.tools.length > 0 ? (
              <Badge variant="outline" className="h-4.5 px-1.5 text-[10px] metric">
                {component.tools.length} tool{component.tools.length === 1 ? "" : "s"}
              </Badge>
            ) : null}
          </div>
        </li>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-72 space-y-1 text-pretty">
        <p className="font-medium">{component.name}</p>
        <p>{component.description}</p>
        {isAgent && component.tools.length > 0 ? (
          <p className="text-[11px] opacity-80">Uses {component.tools.map((t) => toolMeta[t]?.displayName ?? sentenceCase(t)).join(", ")}</p>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

/** The runtime fills `{{date}}` / `{{job_title}}` on each run; here we show what the first one would be called. */
function exampleDeliverableTitle(template: string, jobTitle: string): string {
  return template.replaceAll("{{job_title}}", jobTitle).replaceAll("{{date}}", formatDate(new Date()));
}

/**
 * The top half of "Meet your worker": who they are, why they were designed this way, what they will do, how the
 * work flows and which tools they need. Server-safe; the hire controls live in `ProposalActions`.
 */
export function ProposalCard({ proposal, jobTitle, toolMeta }: { proposal: WorkerProposal; jobTitle: string; toolMeta: Record<string, ToolMeta> }) {
  const { blueprint } = proposal;
  const { persona } = blueprint;
  const agentSteps = blueprint.components.filter((c) => c.type === "agent").length;
  const autoSteps = blueprint.components.length - agentSteps;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <WorkerAvatar name={persona.name} color={persona.avatarColor} size="lg" className="size-20 text-2xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-semibold tracking-tight">{persona.name}</h2>
              {proposal.simulated ? <SimulatedBadge /> : null}
            </div>
            <p className="text-sm font-medium text-muted-foreground">{persona.title}</p>
            <p className="max-w-prose text-sm text-pretty">{persona.summary}</p>
            <p className="text-xs text-muted-foreground">
              Proposal designed <RelativeTime iso={proposal.generatedAt} />
              {" · "}
              {agentSteps} AI step{agentSteps === 1 ? "" : "s"}, {autoSteps} automated
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lightbulb className="size-4 text-muted-foreground" aria-hidden="true" />
              Why this design
            </CardTitle>
            <CardDescription>How the staffing engine matched the job.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {proposal.rationale.map((line, i) => (
                <li key={`${i}-${line}`} className="flex gap-2.5">
                  <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/60" />
                  <span className="text-pretty">{line}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What {persona.name} will do</CardTitle>
            <CardDescription>Responsibilities on every run.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {blueprint.responsibilities.map((line, i) => (
                <li key={`${i}-${line}`} className="flex gap-2.5">
                  <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                  <span className="text-pretty">{line}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>How the work flows</CardTitle>
          <CardDescription>
            AI steps think and use tools; automated steps are plain code — free, fast and predictable. Hover a step for details.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="flex items-center gap-2 overflow-x-auto pb-2">
            {blueprint.components.map((component, i) => (
              <Fragment key={component.id}>
                {i > 0 ? <ArrowRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden="true" /> : null}
                <PipelineStep component={component} toolMeta={toolMeta} />
              </Fragment>
            ))}
          </ol>
          <p className="mt-2 text-xs text-muted-foreground">
            Delivers <span className="font-medium text-foreground">“{exampleDeliverableTitle(blueprint.deliverable.titleTemplate, jobTitle)}”</span> as{" "}
            {blueprint.deliverable.format === "csv" ? "a CSV" : blueprint.deliverable.format === "json" ? "structured data" : "a report"}.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="size-4 text-muted-foreground" aria-hidden="true" />
            Tools and permissions
          </CardTitle>
          <CardDescription>Granted on hire. Anything marked for approval pauses the run until you say yes.</CardDescription>
        </CardHeader>
        <CardContent>
          {blueprint.tools.length === 0 ? (
            <p className="text-sm text-muted-foreground">No external tools — {persona.name} works only from what the job provides.</p>
          ) : (
            <ul className="divide-y">
              {blueprint.tools.map((tool) => {
                const meta = toolMeta[tool.toolName];
                return (
                  <li key={tool.toolName} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{meta?.displayName ?? sentenceCase(tool.toolName)}</p>
                      <p className="text-xs text-pretty text-muted-foreground">{tool.reason}</p>
                    </div>
                    {tool.requiresApproval ? (
                      <Badge variant="outline" className="shrink-0 gap-1 border-amber-200 bg-amber-50 text-amber-800">
                        <ShieldAlert aria-hidden="true" />
                        Approval required
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="shrink-0 text-muted-foreground">
                        Runs freely
                      </Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
