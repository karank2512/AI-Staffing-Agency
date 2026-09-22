"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { toast } from "sonner";
import type { FollowUpQuestion } from "@/server/domain";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { buildJobSpecAction } from "../actions";
import { MAX_ANSWER_CHARS } from "../schema";
import { DiscardJobLink } from "./discard-job-button";
import { InlineError, StepBar, stepLinkClass } from "./step-bar";

export interface ClarifyFormProps {
  jobId: string;
  jobTitle: string;
  questions: FollowUpQuestion[];
  /** Answers saved on a previous visit (resume mid-flow). */
  initialAnswers: Record<string, string>;
  /** MEMBERs can read the flow but cannot move it along — the server refuses jobs.manage either way. */
  canManage: boolean;
}

/**
 * Step 2 — Clarify. One question per card, each with selectable suggestion tiles and a free-text answer.
 * Every question can be skipped: a blank answer is simply not sent.
 */
export function ClarifyForm({ jobId, jobTitle, questions, initialAnswers, canManage }: ClarifyFormProps) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>(() => ({ ...initialAnswers }));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const answered = questions.filter((q) => (answers[q.id] ?? "").trim().length > 0).length;
  const overLimit = questions.some((q) => (answers[q.id] ?? "").length > MAX_ANSWER_CHARS);

  function setAnswer(id: string, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
    if (error) setError(null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || overLimit || !canManage) return;
    setError(null);
    startTransition(async () => {
      const result = await buildJobSpecAction(jobId, answers);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success(`Drafted the job spec for “${result.data.title}”. Give it a once-over.`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} aria-busy={pending} className="space-y-6">
      {questions.length === 0 ? (
        <Card>
          <CardContent className="space-y-2">
            <h2 className="text-title-3">Nothing to ask</h2>
            <p className="text-callout text-pretty text-muted-foreground">
              “{jobTitle}” is clear enough to draft a spec straight away.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {questions.map((question, index) => {
        const value = answers[question.id] ?? "";
        const skipped = value.trim().length === 0;
        const tooLong = value.length > MAX_ANSWER_CHARS;
        const inputId = `q-${question.id}`;
        return (
          <Card key={question.id}>
            <CardContent className="space-y-5">
              <div className="space-y-1.5">
                <p className="text-footnote text-muted-foreground">
                  <span className="metric">
                    Question {index + 1} of {questions.length}
                  </span>
                  {skipped ? null : " · answered"}
                </p>
                <label htmlFor={inputId} className="block text-title-3 text-balance text-foreground">
                  {question.question}
                </label>
                {question.why ? <p className="text-callout text-pretty text-muted-foreground">{question.why}</p> : null}
              </div>

              {question.suggestions.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Suggested answers">
                  {question.suggestions.map((suggestion) => {
                    const selected = value.trim() === suggestion;
                    return (
                      <button
                        key={suggestion}
                        type="button"
                        disabled={pending || !canManage}
                        aria-pressed={selected}
                        onClick={() => setAnswer(question.id, selected ? "" : suggestion)}
                        className={cn(
                          "relative min-h-11 rounded-[14px] border border-input bg-background px-4 py-2.5 pr-10 text-left text-callout text-pretty",
                          "transition-[border-color,background-color,box-shadow] duration-200 ease-standard outline-none",
                          "hover:bg-muted focus-visible:ring-4 focus-visible:ring-primary/30 disabled:opacity-40",
                          selected && "border-primary bg-background shadow-[inset_0_0_0_1px_var(--primary)] hover:bg-background",
                        )}
                      >
                        {suggestion}
                        {selected ? (
                          <Check className="absolute top-3 right-3.5 size-4 text-primary" aria-hidden="true" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              <div className="space-y-2">
                <Textarea
                  id={inputId}
                  value={value}
                  onChange={(e) => setAnswer(question.id, e.target.value)}
                  placeholder={question.placeholder ?? "Type an answer, pick a suggestion, or leave it blank"}
                  disabled={pending || !canManage}
                  aria-invalid={tooLong ? true : undefined}
                  className="min-h-20"
                />
                <div className="flex items-center justify-between gap-3 text-footnote text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => setAnswer(question.id, "")}
                    disabled={pending || skipped || !canManage}
                    className={cn(stepLinkClass, "font-normal disabled:invisible")}
                  >
                    Clear this answer
                  </button>
                  {tooLong ? <span className="text-danger">Keep it under {MAX_ANSWER_CHARS.toLocaleString("en-US")} characters.</span> : null}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}

      {error ? <InlineError>{error}</InlineError> : null}

      <StepBar
        note={
          canManage ? (
            <>
              {questions.length > 0 ? (
                <span className="metric">
                  {answered} of {questions.length} answered.{" "}
                </span>
              ) : null}
              Anything you skip gets a sensible default. <DiscardJobLink jobId={jobId} disabled={pending} />
            </>
          ) : (
            "Only workspace admins and owners can change a job."
          )
        }
      >
        <Button type="submit" size="lg" disabled={pending || overLimit || !canManage} className="max-sm:w-full">
          {pending ? "Drafting the spec…" : "Draft the job spec"}
        </Button>
      </StepBar>
    </form>
  );
}
