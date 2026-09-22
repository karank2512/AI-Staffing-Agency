"use client";

import { useId, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, WandSparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { scopeJobAction } from "../actions";
import { DESCRIPTION_MAX_CHARS, DESCRIPTION_MIN_CHARS, DESCRIPTION_PLACEHOLDER, EXAMPLE_JOBS } from "../schema";

/**
 * Step 1 — Describe. A single large textarea plus three example jobs that fill it. "Scope this job" creates the
 * DRAFT job and replaces the URL with `?jobId=`, from which point the server derives every later step.
 */
export function DescribeForm() {
  const router = useRouter();
  const textareaId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const length = text.trim().length;
  const tooShort = length < DESCRIPTION_MIN_CHARS;
  const tooLong = length > DESCRIPTION_MAX_CHARS;
  const canSubmit = !tooShort && !tooLong && !pending;
  const activeExample = EXAMPLE_JOBS.find((job) => job.description === text)?.id ?? null;

  function applyExample(description: string) {
    setText(description);
    setError(null);
    textareaRef.current?.focus();
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      const result = await scopeJobAction(text);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      const n = result.data.questionCount;
      toast.success(n > 0 ? `Got it. ${n} quick question${n === 1 ? "" : "s"} before we draft the spec.` : "Got it. Let's draft the job spec.");
      router.replace(result.data.redirectTo);
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submit();
  }

  return (
    <form onSubmit={submit} aria-busy={pending} className="space-y-4">
      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor={textareaId} className="text-sm font-medium">
              What do you need done?
            </label>
            <Textarea
              id={textareaId}
              ref={textareaRef}
              name="description"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={onKeyDown}
              placeholder={DESCRIPTION_PLACEHOLDER}
              disabled={pending}
              aria-invalid={error !== null || tooLong ? true : undefined}
              aria-describedby={`${textareaId}-hint`}
              className="min-h-44 resize-y text-[15px] leading-relaxed md:text-[15px]"
              autoFocus
            />
            <div id={`${textareaId}-hint`} className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                Plain English is perfect. Mention what to produce, how often, and who it is for — we&apos;ll ask about the rest.
              </span>
              <span className={cn("metric", tooLong && "text-rose-600")}>
                {length.toLocaleString("en-US")} / {DESCRIPTION_MAX_CHARS.toLocaleString("en-US")}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <p className="eyebrow">Or start from an example</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_JOBS.map((job) => (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => applyExample(job.description)}
                  disabled={pending}
                  aria-pressed={activeExample === job.id}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors",
                    "hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50",
                    activeExample === job.id ? "border-primary/30 bg-primary/10 text-foreground" : "border-border bg-background text-foreground",
                  )}
                >
                  <Sparkles className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  {job.label}
                </button>
              ))}
            </div>
          </div>

          {error ? (
            <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Scoping takes a few seconds. <kbd className="rounded border bg-background px-1 font-mono text-[10px]">⌘</kbd>+
            <kbd className="rounded border bg-background px-1 font-mono text-[10px]">Enter</kbd> to submit.
          </p>
          <Button type="submit" disabled={!canSubmit}>
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <WandSparkles aria-hidden="true" />}
            {pending ? "Scoping the job…" : "Scope this job"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
