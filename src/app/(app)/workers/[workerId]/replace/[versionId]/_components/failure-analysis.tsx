import { Section } from "@/components/section";
import { SimulatedBadge } from "@/components/simulated-badge";
import { Card, CardContent } from "@/components/ui/card";
import { pluralize } from "@/lib/format";
import type { ReplacementAnalysis } from "@/server/domain";

const AREA_LABELS: Record<ReplacementAnalysis["changes"][number]["area"], string> = {
  instructions: "Instructions",
  model: "Model",
  tools: "Tools",
  pipeline: "Pipeline",
  evaluation: "Evaluation",
  limits: "Limits",
  schedule: "Schedule",
  deliverable: "Deliverable",
};

/** The performance-review half of a replacement: what went wrong, why, and what the evidence was. */
export function FailureAnalysis({ analysis, workerName }: { analysis: ReplacementAnalysis; workerName: string }) {
  const { basedOn } = analysis;
  const evidence = [
    pluralize(basedOn.runs, "run"),
    `${basedOn.failedRuns} failed`,
    pluralize(basedOn.evaluations, "evaluation"),
    `${basedOn.rejectedDeliverables} sent back`,
  ].join(" · ");

  return (
    <Section
      title={`What went wrong with ${workerName}`}
      description={`Read from the last ${basedOn.windowDays} days: ${evidence}.`}
    >
      <Card>
        <CardContent className="space-y-8">
          <p className="max-w-[65ch] text-[17px] text-pretty">{analysis.summary}</p>

          {analysis.failurePatterns.length > 0 ? (
            <div>
              <p className="eyebrow mb-3">What kept happening</p>
              <ul className="flex flex-col gap-4">
                {analysis.failurePatterns.map((p, i) => (
                  <li key={`${i}-${p.pattern}`} className="max-w-[70ch]">
                    <p className="text-[15px] font-medium text-pretty">{p.pattern}</p>
                    <p className="text-footnote mt-1 text-pretty text-muted-foreground">
                      {p.evidence}
                      <span className="metric">
                        {" "}
                        · {p.occurrences === 1 ? "once" : `${p.occurrences} times`} · {p.severity} severity
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="grid gap-8 sm:grid-cols-2">
            {analysis.rootCauses.length > 0 ? (
              <div>
                <p className="eyebrow mb-3">Why</p>
                <ul className="space-y-2.5">
                  {analysis.rootCauses.map((cause, i) => (
                    <li key={`${i}-${cause}`} className="text-[15px] text-pretty">
                      {cause}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {analysis.changes.length > 0 ? (
              <div>
                <p className="eyebrow mb-3">What the replacement does differently</p>
                <ul className="space-y-3">
                  {analysis.changes.map((c, i) => (
                    <li key={`${c.area}-${i}`}>
                      <p className="text-[15px] text-pretty">
                        <span className="font-medium">{AREA_LABELS[c.area]}:</span> {c.description}
                      </p>
                      <p className="text-footnote mt-0.5 text-pretty text-muted-foreground">{c.rationale}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          {analysis.simulated ? (
            <p className="text-footnote flex items-center gap-2 text-muted-foreground">
              <SimulatedBadge /> This analysis was written by the simulator, not a live model.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </Section>
  );
}
