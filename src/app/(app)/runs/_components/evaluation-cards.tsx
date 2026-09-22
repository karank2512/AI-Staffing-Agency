import type { EvaluationType } from "@prisma/client";
import { Check, ClipboardCheck, Gavel, MessageSquareQuote, X } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ScoreRing } from "@/components/score-ring";
import { SimulatedBadge } from "@/components/simulated-badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { EvaluationDetails } from "@/server/domain/evaluation";

/**
 * Cards for the three verdicts a deliverable can carry: automated checks, the reviewer model's rubric scores
 * and the customer's own accept/reject. Server-safe (no hooks); used by /runs/[runId] and /deliverables/[id].
 */

export interface EvaluationCardData {
  id: string;
  type: EvaluationType;
  /** 0..1 */
  score: number;
  passed: boolean;
  summary: string | null;
  details: EvaluationDetails | null;
  createdAt: string;
}

const ORDER: Record<EvaluationType, number> = { DETERMINISTIC: 0, LLM_JUDGE: 1, USER_FEEDBACK: 2 };

function PassFail({ passed }: { passed: boolean }) {
  return passed ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
      <Check className="size-3.5" aria-hidden="true" /> Pass
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-600">
      <X className="size-3.5" aria-hidden="true" /> Fail
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, score)) * 100);
  const color = pct >= 80 ? "bg-emerald-500" : pct >= 65 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right text-xs tabular-nums">{pct}</span>
    </div>
  );
}

function DeterministicCard({ evaluation, workerName }: { evaluation: EvaluationCardData; workerName: string }) {
  const checks = evaluation.details?.kind === "deterministic" ? evaluation.details.checks : [];
  const passedCount = checks.filter((c) => c.passed).length;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheck className="size-4 text-muted-foreground" aria-hidden="true" /> Automated checks
        </CardTitle>
        <CardDescription>
          {checks.length > 0 ? `${passedCount} of ${checks.length} checks passed` : (evaluation.summary ?? `Rules applied to what ${workerName} delivered.`)}
          {" · "}
          {formatDateTime(evaluation.createdAt)}
        </CardDescription>
        <CardAction>
          <ScoreRing score={Math.round(evaluation.score * 100)} size={40} />
        </CardAction>
      </CardHeader>
      {checks.length > 0 ? (
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Check</TableHead>
                <TableHead className="w-20">Result</TableHead>
                <TableHead>Observed</TableHead>
                <TableHead>Expected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {checks.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="max-w-64 whitespace-normal text-pretty">{c.description}</TableCell>
                  <TableCell>
                    <PassFail passed={c.passed} />
                  </TableCell>
                  <TableCell className="whitespace-normal tabular-nums text-muted-foreground">{c.observed}</TableCell>
                  <TableCell className="whitespace-normal tabular-nums text-muted-foreground">{c.expected}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      ) : null}
    </Card>
  );
}

function JudgeCard({ evaluation }: { evaluation: EvaluationCardData }) {
  const details = evaluation.details?.kind === "llm_judge" ? evaluation.details : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gavel className="size-4 text-muted-foreground" aria-hidden="true" /> Reviewer’s assessment
          {details?.simulated ? <SimulatedBadge /> : null}
        </CardTitle>
        <CardDescription>
          {details ? `Scored against the job’s rubric by ${details.model}` : (evaluation.summary ?? "Scored against the job’s rubric")}
          {" · "}
          {formatDateTime(evaluation.createdAt)}
        </CardDescription>
        <CardAction>
          <ScoreRing score={Math.round(evaluation.score * 100)} size={40} />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {details ? (
          <>
            <ul className="divide-y">
              {details.criteria.map((c) => (
                <li key={c.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{c.criterion}</p>
                    <p className="mt-0.5 text-sm text-pretty text-muted-foreground">{c.reasoning}</p>
                  </div>
                  <div className="shrink-0 pt-0.5">
                    <ScoreBar score={c.score} />
                    <p className="mt-0.5 text-right text-[11px] text-muted-foreground">weight {formatPercent(c.weight)}</p>
                  </div>
                </li>
              ))}
            </ul>
            {details.overallReasoning ? (
              <blockquote className="border-l-2 pl-3 text-sm text-pretty text-muted-foreground">{details.overallReasoning}</blockquote>
            ) : null}
          </>
        ) : evaluation.summary ? (
          <p className="text-sm text-muted-foreground">{evaluation.summary}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function FeedbackCard({ evaluation }: { evaluation: EvaluationCardData }) {
  const details = evaluation.details?.kind === "user_feedback" ? evaluation.details : null;
  const accepted = details ? details.decision === "accepted" : evaluation.passed;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquareQuote className="size-4 text-muted-foreground" aria-hidden="true" /> Your review
        </CardTitle>
        <CardDescription>
          {evaluation.summary ?? (accepted ? "Accepted" : "Sent back")} · {formatDateTime(evaluation.createdAt)}
        </CardDescription>
        <CardAction>
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", accepted ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700")}>
            {accepted ? <Check className="size-3" aria-hidden="true" /> : <X className="size-3" aria-hidden="true" />}
            {accepted ? "Accepted" : "Rejected"}
          </span>
        </CardAction>
      </CardHeader>
      {details?.feedback ? (
        <CardContent>
          <blockquote className="border-l-2 pl-3 text-sm text-pretty italic text-muted-foreground">“{details.feedback}”</blockquote>
        </CardContent>
      ) : null}
    </Card>
  );
}

export interface EvaluationCardsProps {
  evaluations: EvaluationCardData[];
  workerName: string;
  /** Shown when there is nothing yet. */
  emptyDescription?: string;
}

export function EvaluationCards({ evaluations, workerName, emptyDescription }: EvaluationCardsProps) {
  if (evaluations.length === 0) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title="Not evaluated yet"
        description={emptyDescription ?? `Automated checks and the reviewer model run as soon as ${workerName} finishes.`}
      />
    );
  }
  const sorted = [...evaluations].sort((a, b) => ORDER[a.type] - ORDER[b.type]);
  return (
    <div className="grid gap-4">
      {sorted.map((e) =>
        e.type === "DETERMINISTIC" ? (
          <DeterministicCard key={e.id} evaluation={e} workerName={workerName} />
        ) : e.type === "LLM_JUDGE" ? (
          <JudgeCard key={e.id} evaluation={e} />
        ) : (
          <FeedbackCard key={e.id} evaluation={e} />
        ),
      )}
    </div>
  );
}
