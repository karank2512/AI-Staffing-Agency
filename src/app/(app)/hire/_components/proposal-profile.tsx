import type { WorkerProposal } from "@/server/domain";
import type { ToolMeta } from "@/server/queries/hire";
import { RelativeTime } from "@/components/relative-time";
import { SimulatedBadge } from "@/components/simulated-badge";
import { WorkerAvatar } from "@/components/worker-avatar";
import { formatDate, formatUsdPrecise, sentenceCase } from "@/lib/format";
import { MODEL_TIER_LABELS, operationLabel } from "../schema";

/** The runtime fills `{{date}}` / `{{job_title}}` on each run; here we show what the first one would be called. */
function exampleDeliverableTitle(template: string, jobTitle: string): string {
  return template.replaceAll("{{job_title}}", jobTitle).replaceAll("{{date}}", formatDate(new Date()));
}

/** "Searches the public web" — the tool in a sentence, with its approval posture as a second clause. */
function toolSentence(displayName: string, meta: ToolMeta | undefined, requiresApproval: boolean): string {
  const base = meta?.humanDescription ?? displayName;
  return requiresApproval ? `${base} Asks you first.` : base;
}

/**
 * "Meet your worker", top half: the résumé. Big avatar, the name as the page's single `<h1>`, the role, a bio,
 * then three plain columns — what they do, what they can touch, what it costs.
 */
export function ProposalResume({
  proposal,
  toolMeta,
}: {
  proposal: WorkerProposal;
  toolMeta: Record<string, ToolMeta>;
}) {
  const { blueprint } = proposal;
  const { persona } = blueprint;

  return (
    <article className="rounded-[22px] bg-card p-8 shadow-card max-sm:p-6">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-7">
        <WorkerAvatar name={persona.name} color={persona.avatarColor} size="xl" />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <p className="text-footnote text-muted-foreground">Your proposed hire</p>
            <h1 className="text-headline text-balance text-foreground">{persona.name}</h1>
            <p className="text-body-lg text-muted-foreground">{persona.title}</p>
          </div>
          <p className="max-w-[58ch] text-body text-pretty">{persona.summary}</p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-footnote text-muted-foreground">
            <span>
              Designed <RelativeTime iso={proposal.generatedAt} />
            </span>
            {proposal.simulated ? (
              <>
                <span aria-hidden="true">·</span>
                <SimulatedBadge />
              </>
            ) : null}
          </p>
        </div>
      </header>

      <div className="mt-8 grid gap-8 border-t border-border pt-7 sm:grid-cols-3">
        <section className="space-y-2.5">
          <h2 className="text-callout font-medium text-muted-foreground">What {persona.name} does each run</h2>
          <ul className="space-y-2 text-callout">
            {blueprint.responsibilities.map((line, i) => (
              <li key={`${i}-${line}`}>{line}</li>
            ))}
          </ul>
        </section>

        <section className="space-y-2.5">
          <h2 className="text-callout font-medium text-muted-foreground">Tools and access</h2>
          {blueprint.tools.length === 0 ? (
            <p className="text-callout text-muted-foreground">No outside tools — works only from what the job provides.</p>
          ) : (
            <ul className="space-y-2.5 text-callout">
              {blueprint.tools.map((tool) => {
                const meta = toolMeta[tool.toolName];
                const name = meta?.displayName ?? sentenceCase(tool.toolName);
                return (
                  <li key={tool.toolName}>
                    <span>{toolSentence(name, meta, tool.requiresApproval)}</span>
                    <span className="block text-footnote text-muted-foreground">{tool.reason}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="space-y-1">
          <h2 className="text-callout font-medium text-muted-foreground">Expected cost</h2>
          <p className="text-metric text-foreground">{formatUsdPrecise(blueprint.costEstimate.perRunUsd)}</p>
          <p className="text-footnote text-muted-foreground">per run, estimated</p>
        </section>
      </div>
    </article>
  );
}

/** Why the staffing engine landed on this design — the reasoning, in the engine's own sentences. */
export function ProposalRationale({ proposal }: { proposal: WorkerProposal }) {
  return (
    <ul className="space-y-4 text-body text-pretty">
      {proposal.rationale.map((line, i) => (
        <li key={`${i}-${line}`}>{line}</li>
      ))}
    </ul>
  );
}

/**
 * The pipeline as a horizontal flow: a node per step on one rail, each with its name, what it does, and
 * whether it thinks (an LLM step) or just runs code. Two states, no colour coding, no icons.
 */
export function ProposalPipeline({ proposal, jobTitle }: { proposal: WorkerProposal; jobTitle: string }) {
  const { blueprint } = proposal;
  const format = blueprint.deliverable.format;
  const formatWord = format === "csv" ? "a CSV" : format === "json" ? "structured data" : "a report";

  return (
    <div className="space-y-5">
      <ol className="-mx-6 flex snap-x snap-proximity overflow-x-auto px-6 pb-2 sm:mx-0 sm:px-0">
        {blueprint.components.map((component, index) => {
          const isAgent = component.type === "agent";
          const isLast = index === blueprint.components.length - 1;
          return (
            <li key={component.id} className="relative min-w-56 shrink-0 snap-start pr-7 last:min-w-0 last:pr-0 sm:flex-1">
              {isLast ? null : <span aria-hidden="true" className="absolute top-[5px] right-0 left-3.5 h-px bg-border" />}
              <span
                aria-hidden="true"
                className={
                  isAgent
                    ? "relative block size-[11px] rounded-full bg-foreground"
                    : "relative block size-[11px] rounded-full border border-input bg-background"
                }
              />
              <div className="mt-3.5 space-y-1 pr-4">
                <p className="text-callout font-medium">{component.name}</p>
                <p className="text-footnote text-pretty text-muted-foreground">{component.description}</p>
                <p className="text-footnote text-muted-foreground">
                  {isAgent ? `Thinks · ${MODEL_TIER_LABELS[component.modelTier]}` : `Runs as code · ${operationLabel(component.operation)}`}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="text-callout text-pretty text-muted-foreground">
        Ends with <span className="font-medium text-foreground">“{exampleDeliverableTitle(blueprint.deliverable.titleTemplate, jobTitle)}”</span> as {formatWord}.
        Steps that run as code are free, fast and give the same answer every time.
      </p>
    </div>
  );
}
