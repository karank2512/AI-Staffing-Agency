"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, MessageCircleQuestion } from "lucide-react";
import { toast } from "sonner";
import type { FollowUpQuestion } from "@/server/domain";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { buildJobSpecAction } from "../actions";
import { MAX_ANSWER_CHARS } from "../schema";
import { DiscardJobButton } from "./discard-job-button";

export interface ClarifyFormProps {
  jobId: string;
  jobTitle: string;
  questions: FollowUpQuestion[];
  /** Answers saved on a previous visit (resume mid-flow). */
  initialAnswers: Record<string, string>;
}

/**
 * Step 2 — Clarify. Up to three follow-ups with a "why we ask" line and quick-pick suggestions. Every question can
 * be skipped: a blank answer is simply not sent. "Build job spec" drafts the spec and the server moves the step.
 */
export function ClarifyForm({ jobId, jobTitle, questions, initialAnswers }: ClarifyFormProps) {
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
    if (pending || overLimit) return;
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
    <form onSubmit={submit} aria-busy={pending} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircleQuestion className="size-4 text-muted-foreground" aria-hidden="true" />
            {questions.length > 0 ? "A few quick questions" : "No questions needed"}
          </CardTitle>
          <CardDescription>
            {questions.length > 0
              ? `They shape the spec for “${jobTitle}”. Skip anything you are unsure about — sensible defaults apply.`
              : `“${jobTitle}” is clear enough to draft a spec straight away.`}
          </CardDescription>
        </CardHeader>
        <CardContent className={cn(questions.length > 0 && "divide-y")}>
          {questions.map((question, index) => {
            const value = answers[question.id] ?? "";
            const skipped = value.trim().length === 0;
            const tooLong = value.length > MAX_ANSWER_CHARS;
            const inputId = `q-${question.id}`;
            return (
              <fieldset key={question.id} className="space-y-3 py-5 first:pt-0 last:pb-0">
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums ring-1 ring-foreground/10 ring-inset"
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <label htmlFor={inputId} className="block text-sm font-medium text-foreground">
                      {question.question}
                    </label>
                    {question.why ? <p className="text-[13px] text-muted-foreground">Why we ask: {question.why}</p> : null}
                  </div>
                  <span className={cn("shrink-0 text-xs", skipped ? "text-muted-foreground" : "text-emerald-600")}>
                    {skipped ? "Optional" : "Answered"}
                  </span>
                </div>

                {question.suggestions.length > 0 ? (
                  <div className="flex flex-wrap gap-2 pl-9" role="group" aria-label="Suggested answers">
                    {question.suggestions.map((suggestion) => {
                      const selected = value.trim() === suggestion;
                      return (
                        <button
                          key={suggestion}
                          type="button"
                          disabled={pending}
                          aria-pressed={selected}
                          onClick={() => setAnswer(question.id, selected ? "" : suggestion)}
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-[13px] transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50",
                            selected ? "border-primary/30 bg-primary/10 font-medium text-foreground" : "border-border bg-background text-foreground",
                          )}
                        >
                          {suggestion}
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                <div className="space-y-1 pl-9">
                  <Textarea
                    id={inputId}
                    value={value}
                    onChange={(e) => setAnswer(question.id, e.target.value)}
                    placeholder={question.placeholder ?? "Type an answer, pick a suggestion, or leave blank to skip"}
                    disabled={pending}
                    aria-invalid={tooLong ? true : undefined}
                    className="min-h-16"
                  />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <button
                      type="button"
                      onClick={() => setAnswer(question.id, "")}
                      disabled={pending || skipped}
                      className="underline-offset-2 hover:underline disabled:invisible"
                    >
                      Skip this question
                    </button>
                    {tooLong ? <span className="text-rose-600">Keep each answer under {MAX_ANSWER_CHARS.toLocaleString("en-US")} characters.</span> : null}
                  </div>
                </div>
              </fieldset>
            );
          })}

          {error ? (
            <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="flex-wrap justify-between gap-3">
          <div className="flex items-center gap-3">
            <DiscardJobButton jobId={jobId} disabled={pending} />
            {questions.length > 0 ? (
              <span className="text-xs text-muted-foreground metric">
                {answered} of {questions.length} answered
              </span>
            ) : null}
          </div>
          <Button type="submit" disabled={pending || overLimit}>
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <FileText aria-hidden="true" />}
            {pending ? "Drafting the spec…" : "Build job spec"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
