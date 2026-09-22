"use client";

import { useState, useTransition, type FormEvent, type SelectHTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Hash, Loader2, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { describeCadence, type Cadence } from "@/server/domain";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { updateJobSpecAction } from "../actions";
import { CADENCE_KIND_LABELS, DAY_LABELS, SpecPatchSchema, hourLabel, parseResponsibilityLines, type SpecPatch } from "../schema";

export interface SpecEditorProps {
  jobId: string;
  jobSpecId: string;
  familyLabel: string;
  statusLabel: string;
  title: string;
  summary: string;
  objective: string;
  responsibilities: string[];
  cadence: Cadence;
  targetCount: number | null;
  /** Records per run only make sense for record-based deliverables (fields defined). */
  showTargetCount: boolean;
}

function SelectInput({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The editable heart of the spec: title, summary, objective, responsibilities, cadence and target volume. Reads as
 * a role description; "Edit details" flips it into a small form. Only changed fields are sent, and the server
 * re-validates the whole spec so a bad edit never reaches an approved state.
 */
export function SpecEditor(props: SpecEditorProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(() => toForm(props));

  function open() {
    setForm(toForm(props));
    setError(null);
    setEditing(true);
  }

  function close() {
    setEditing(false);
    setError(null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const patch = diffPatch(props, form);
    if (Object.keys(patch).length === 0) {
      close();
      return;
    }
    const parsed = SpecPatchSchema.safeParse(patch);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the highlighted fields.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await updateJobSpecAction(props.jobId, props.jobSpecId, parsed.data);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Spec updated.");
      setEditing(false);
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <Card>
        <CardHeader className="border-b pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="eyebrow">
                {props.familyLabel} · {props.statusLabel}
              </p>
              <h2 className="text-lg font-semibold tracking-tight text-balance">{props.title}</h2>
              <p className="text-sm text-pretty text-muted-foreground">{props.summary}</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={open}>
              <Pencil aria-hidden="true" />
              Edit details
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-[1fr_auto]">
          <div className="space-y-5">
            <div>
              <p className="eyebrow mb-1.5">Objective</p>
              <p className="text-sm text-pretty">{props.objective}</p>
            </div>
            <div>
              <p className="eyebrow mb-1.5">Responsibilities</p>
              <ul className="space-y-1.5 text-sm">
                {props.responsibilities.map((item, i) => (
                  <li key={`${i}-${item}`} className="flex gap-2.5">
                    <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/60" />
                    <span className="text-pretty">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <dl className="grid min-w-52 content-start gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
            <div className="flex items-start gap-2.5">
              <CalendarClock className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
              <div>
                <dt className="text-xs text-muted-foreground">Cadence</dt>
                <dd className="font-medium">{describeCadence(props.cadence)}</dd>
              </div>
            </div>
            {props.showTargetCount ? (
              <div className="flex items-start gap-2.5">
                <Hash className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
                <div>
                  <dt className="text-xs text-muted-foreground">Target per run</dt>
                  <dd className="font-medium metric">{props.targetCount ? `about ${props.targetCount} records` : "No fixed target"}</dd>
                </div>
              </div>
            ) : null}
          </dl>
        </CardContent>
      </Card>
    );
  }

  const showHour = form.cadenceKind === "daily" || form.cadenceKind === "weekly";
  const showDay = form.cadenceKind === "weekly";

  return (
    <form onSubmit={submit} aria-busy={pending}>
      <Card>
        <CardHeader className="border-b pb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="eyebrow">Editing · {props.statusLabel}</p>
              <h2 className="text-base font-semibold tracking-tight">Adjust the role</h2>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={close} disabled={pending}>
              <X aria-hidden="true" />
              Cancel
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="spec-title">Job title</Label>
            <Input id="spec-title" value={form.title} maxLength={120} disabled={pending} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="spec-summary">Summary</Label>
            <Textarea id="spec-summary" value={form.summary} disabled={pending} className="min-h-16" onChange={(e) => setForm({ ...form, summary: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="spec-objective">Objective</Label>
            <Textarea id="spec-objective" value={form.objective} disabled={pending} className="min-h-16" onChange={(e) => setForm({ ...form, objective: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="spec-responsibilities">Responsibilities</Label>
            <Textarea
              id="spec-responsibilities"
              value={form.responsibilities}
              disabled={pending}
              className="min-h-28 font-mono text-[13px] md:text-[13px]"
              onChange={(e) => setForm({ ...form, responsibilities: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">One per line, up to 8.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="spec-cadence">Cadence</Label>
              <SelectInput id="spec-cadence" value={form.cadenceKind} disabled={pending} onChange={(e) => setForm({ ...form, cadenceKind: e.target.value as Cadence["kind"] })}>
                {(Object.keys(CADENCE_KIND_LABELS) as Cadence["kind"][]).map((kind) => (
                  <option key={kind} value={kind}>
                    {CADENCE_KIND_LABELS[kind]}
                  </option>
                ))}
              </SelectInput>
            </div>
            {showDay ? (
              <div className="space-y-2">
                <Label htmlFor="spec-day">Day</Label>
                <SelectInput id="spec-day" value={form.dayOfWeek} disabled={pending} onChange={(e) => setForm({ ...form, dayOfWeek: Number(e.target.value) })}>
                  {DAY_LABELS.map((day, i) => (
                    <option key={day} value={i}>
                      {day}
                    </option>
                  ))}
                </SelectInput>
              </div>
            ) : null}
            {showHour ? (
              <div className="space-y-2">
                <Label htmlFor="spec-hour">Time</Label>
                <SelectInput id="spec-hour" value={form.hour} disabled={pending} onChange={(e) => setForm({ ...form, hour: Number(e.target.value) })}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </SelectInput>
              </div>
            ) : null}
            {props.showTargetCount ? (
              <div className="space-y-2">
                <Label htmlFor="spec-target">Records per run</Label>
                <Input
                  id="spec-target"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={10_000}
                  step={1}
                  placeholder="No fixed target"
                  value={form.targetCount}
                  disabled={pending}
                  onChange={(e) => setForm({ ...form, targetCount: e.target.value })}
                />
              </div>
            ) : null}
          </div>
          {error ? (
            <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button type="button" variant="outline" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

// ── Form state ──────────────────────────────────────────────────────────────

interface FormState {
  title: string;
  summary: string;
  objective: string;
  responsibilities: string;
  cadenceKind: Cadence["kind"];
  hour: number;
  dayOfWeek: number;
  targetCount: string;
}

function toForm(p: SpecEditorProps): FormState {
  return {
    title: p.title,
    summary: p.summary,
    objective: p.objective,
    responsibilities: p.responsibilities.join("\n"),
    cadenceKind: p.cadence.kind,
    hour: p.cadence.hour ?? 9,
    dayOfWeek: p.cadence.dayOfWeek ?? 1,
    targetCount: p.targetCount === null ? "" : String(p.targetCount),
  };
}

function cadenceFrom(f: FormState): Cadence {
  switch (f.cadenceKind) {
    case "manual":
    case "hourly":
      return { kind: f.cadenceKind };
    case "daily":
      return { kind: "daily", hour: f.hour };
    case "weekly":
      return { kind: "weekly", hour: f.hour, dayOfWeek: f.dayOfWeek };
  }
}

function sameCadence(a: Cadence, b: Cadence): boolean {
  return a.kind === b.kind && (a.hour ?? null) === (b.hour ?? null) && (a.dayOfWeek ?? null) === (b.dayOfWeek ?? null);
}

/** Only what changed, so the server merges the rest of the spec untouched. */
function diffPatch(p: SpecEditorProps, f: FormState): SpecPatch {
  const patch: SpecPatch = {};
  if (f.title.trim() !== p.title) patch.title = f.title;
  if (f.summary.trim() !== p.summary) patch.summary = f.summary;
  if (f.objective.trim() !== p.objective) patch.objective = f.objective;
  const lines = parseResponsibilityLines(f.responsibilities);
  if (lines.join("\n") !== p.responsibilities.join("\n")) patch.responsibilities = lines;
  const cadence = cadenceFrom(f);
  if (!sameCadence(cadence, p.cadence)) patch.cadence = cadence;
  if (p.showTargetCount) {
    const raw = f.targetCount.trim();
    const next = raw === "" ? null : Number(raw);
    if (next !== p.targetCount) patch.targetCount = next;
  }
  return patch;
}
