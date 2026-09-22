"use client";

import type { ReactNode, SelectHTMLAttributes } from "react";
import type { Cadence } from "@/server/domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { CADENCE_KIND_LABELS, DAY_LABELS, hourLabel, parseResponsibilityLines, type SpecPatch } from "../schema";
import { InlineError } from "./step-bar";

/** Flat mirror of the spec fields the customer may edit inline. Everything else stays as scoped. */
export interface SpecForm {
  title: string;
  summary: string;
  objective: string;
  responsibilities: string;
  cadenceKind: Cadence["kind"];
  hour: number;
  dayOfWeek: number;
  targetCount: string;
}

export interface SpecFormSource {
  title: string;
  summary: string;
  objective: string;
  responsibilities: string[];
  cadence: Cadence;
  targetCount: number | null;
}

export function toSpecForm(s: SpecFormSource): SpecForm {
  return {
    title: s.title,
    summary: s.summary,
    objective: s.objective,
    responsibilities: s.responsibilities.join("\n"),
    cadenceKind: s.cadence.kind,
    hour: s.cadence.hour ?? 9,
    dayOfWeek: s.cadence.dayOfWeek ?? 1,
    targetCount: s.targetCount === null ? "" : String(s.targetCount),
  };
}

function cadenceFrom(f: SpecForm): Cadence {
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

/** Only what changed, so the server merges the rest of the scoped spec untouched. */
export function diffSpecPatch(s: SpecFormSource, f: SpecForm, showTargetCount: boolean): SpecPatch {
  const patch: SpecPatch = {};
  if (f.title.trim() !== s.title) patch.title = f.title;
  if (f.summary.trim() !== s.summary) patch.summary = f.summary;
  if (f.objective.trim() !== s.objective) patch.objective = f.objective;
  const lines = parseResponsibilityLines(f.responsibilities);
  if (lines.join("\n") !== s.responsibilities.join("\n")) patch.responsibilities = lines;
  const cadence = cadenceFrom(f);
  if (!sameCadence(cadence, s.cadence)) patch.cadence = cadence;
  if (showTargetCount) {
    const raw = f.targetCount.trim();
    const next = raw === "" ? null : Number(raw);
    if (next !== s.targetCount) patch.targetCount = next;
  }
  return patch;
}

function SelectInput({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-11 w-full rounded-lg border border-input bg-background px-3 text-base transition-[border-color,box-shadow] duration-200 ease-standard outline-none",
        "focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:bg-muted sm:text-[15px]",
        className,
      )}
      {...props}
    />
  );
}

function Field({ label, htmlFor, help, children }: { label: string; htmlFor: string; help?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {help ? <p className="text-footnote text-muted-foreground">{help}</p> : null}
    </div>
  );
}

export interface FieldsProps {
  form: SpecForm;
  setForm: (next: SpecForm) => void;
  pending: boolean;
}

export function OverviewFields({ form, setForm, pending }: FieldsProps) {
  return (
    <>
      <Field label="Job title" htmlFor="spec-title">
        <Input id="spec-title" value={form.title} maxLength={120} disabled={pending} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </Field>
      <Field label="Summary" htmlFor="spec-summary" help="One or two sentences a manager would use to describe the role.">
        <Textarea id="spec-summary" value={form.summary} disabled={pending} className="min-h-20" onChange={(e) => setForm({ ...form, summary: e.target.value })} />
      </Field>
    </>
  );
}

export function OutcomeFields({ form, setForm, pending }: FieldsProps) {
  return (
    <>
      <Field label="Objective" htmlFor="spec-objective" help="What the work is for, in one sentence.">
        <Textarea id="spec-objective" value={form.objective} disabled={pending} className="min-h-20" onChange={(e) => setForm({ ...form, objective: e.target.value })} />
      </Field>
      <Field label="Responsibilities" htmlFor="spec-responsibilities" help="One per line, up to 8.">
        <Textarea
          id="spec-responsibilities"
          value={form.responsibilities}
          disabled={pending}
          className="min-h-32"
          onChange={(e) => setForm({ ...form, responsibilities: e.target.value })}
        />
      </Field>
    </>
  );
}

export function ScheduleFields({ form, setForm, pending, showTargetCount }: FieldsProps & { showTargetCount: boolean }) {
  const showHour = form.cadenceKind === "daily" || form.cadenceKind === "weekly";
  const showDay = form.cadenceKind === "weekly";
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="How often" htmlFor="spec-cadence">
        <SelectInput
          id="spec-cadence"
          value={form.cadenceKind}
          disabled={pending}
          onChange={(e) => setForm({ ...form, cadenceKind: e.target.value as Cadence["kind"] })}
        >
          {(Object.keys(CADENCE_KIND_LABELS) as Cadence["kind"][]).map((kind) => (
            <option key={kind} value={kind}>
              {CADENCE_KIND_LABELS[kind]}
            </option>
          ))}
        </SelectInput>
      </Field>
      {showDay ? (
        <Field label="Day" htmlFor="spec-day">
          <SelectInput id="spec-day" value={form.dayOfWeek} disabled={pending} onChange={(e) => setForm({ ...form, dayOfWeek: Number(e.target.value) })}>
            {DAY_LABELS.map((day, i) => (
              <option key={day} value={i}>
                {day}
              </option>
            ))}
          </SelectInput>
        </Field>
      ) : null}
      {showHour ? (
        <Field label="Time" htmlFor="spec-hour">
          <SelectInput id="spec-hour" value={form.hour} disabled={pending} onChange={(e) => setForm({ ...form, hour: Number(e.target.value) })}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </SelectInput>
        </Field>
      ) : null}
      {showTargetCount ? (
        <Field label="Records per run" htmlFor="spec-target" help="Leave blank for no fixed target.">
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
        </Field>
      ) : null}
    </div>
  );
}

/** The frame every inline edit shares: the fields, one error slot, then Cancel + Save. */
export function EditShell({
  children,
  error,
  pending,
  onCancel,
}: {
  children: ReactNode;
  error: string | null;
  pending: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-4">
      {children}
      {error ? <InlineError>{error}</InlineError> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
