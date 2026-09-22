import { AlertTriangle, ListChecks, Microscope } from "lucide-react";
import { SimulatedBadge } from "@/components/simulated-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { pluralize } from "@/lib/format";
import { TONE_CLASSES } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { ReplacementAnalysis } from "@/server/domain";

const SEVERITY_TONE: Record<ReplacementAnalysis["failurePatterns"][number]["severity"], keyof typeof TONE_CLASSES> = {
  low: "idle",
  medium: "attention",
  high: "failure",
};

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
    `${basedOn.rejectedDeliverables} rejected ${basedOn.rejectedDeliverables === 1 ? "deliverable" : "deliverables"}`,
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Microscope className="size-4 text-muted-foreground" aria-hidden="true" />
          What went wrong with {workerName}
          {analysis.simulated ? <SimulatedBadge /> : null}
        </CardTitle>
        <CardDescription>
          Based on the last {basedOn.windowDays} days: {evidence.join(" · ")}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-pretty">{analysis.summary}</p>

        {analysis.failurePatterns.length > 0 ? (
          <div className="space-y-2">
            <h3 className="eyebrow">Failure patterns</h3>
            <ul className="divide-y rounded-lg border">
              {analysis.failurePatterns.map((p, i) => (
                <li key={`${i}-${p.pattern}`} className="flex items-start gap-3 px-3 py-2.5">
                  <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", TONE_CLASSES[SEVERITY_TONE[p.severity]].text)} aria-hidden="true" />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{p.pattern}</span>
                      <span className={cn("inline-flex h-4.5 items-center rounded-full border px-1.5 text-[11px] font-medium capitalize", TONE_CLASSES[SEVERITY_TONE[p.severity]].badge)}>
                        {p.severity}
                      </span>
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {p.occurrences === 1 ? "1 occurrence" : `${p.occurrences} occurrences`}
                      </span>
                    </div>
                    <p className="text-xs text-pretty text-muted-foreground">{p.evidence}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="grid gap-5 sm:grid-cols-2">
          {analysis.rootCauses.length > 0 ? (
            <div className="space-y-2">
              <h3 className="eyebrow">Root causes</h3>
              <ul className="space-y-1.5 text-sm">
                {analysis.rootCauses.map((cause, i) => (
                  <li key={`${i}-${cause}`} className="flex gap-2">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-rose-400" aria-hidden="true" />
                    <span className="text-pretty">{cause}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {analysis.changes.length > 0 ? (
            <div className="space-y-2">
              <h3 className="eyebrow">What the replacement does differently</h3>
              <ul className="space-y-2 text-sm">
                {analysis.changes.map((c, i) => (
                  <li key={`${c.area}-${i}`} className="flex gap-2">
                    <ListChecks className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-pretty">
                        <span className="font-medium">{AREA_LABELS[c.area]}:</span> {c.description}
                      </p>
                      <p className="text-xs text-pretty text-muted-foreground">{c.rationale}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
