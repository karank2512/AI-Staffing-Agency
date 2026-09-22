"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RelativeTime } from "@/components/relative-time";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { describeCadence, type Cadence } from "@/server/domain";
import { updateScheduleAction } from "../manage-actions";

const KIND_OPTIONS: Array<{ value: Cadence["kind"]; label: string }> = [
  { value: "manual", label: "Only when I ask" },
  { value: "hourly", label: "Every hour" },
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "Every week" },
];

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

function hourLabel(hour: number): string {
  return `${((hour + 11) % 12) + 1}:00 ${hour < 12 ? "AM" : "PM"}`;
}

/** A Cadence that carries only the fields its kind uses — what the schema expects and what the DB stores. */
function normalize(kind: Cadence["kind"], hour: number, dayOfWeek: number): Cadence {
  if (kind === "manual" || kind === "hourly") return { kind };
  if (kind === "daily") return { kind, hour };
  return { kind, hour, dayOfWeek };
}

function sameCadence(a: Cadence, b: Cadence): boolean {
  return a.kind === b.kind && (a.hour ?? null) === (b.hour ?? null) && (a.dayOfWeek ?? null) === (b.dayOfWeek ?? null);
}

export interface PermissionsScheduleEditorProps {
  workerId: string;
  workerName: string;
  schedule: Cadence;
  scheduleLabel: string;
  nextRunAt: string | null;
  status: "ACTIVE" | "PAUSED" | "RETIRED";
  /** The viewer's role can't change the schedule; the server enforces the same rule. */
  readOnly?: boolean;
}

export function PermissionsScheduleEditor({
  workerId,
  workerName,
  schedule,
  scheduleLabel,
  nextRunAt,
  status,
  readOnly = false,
}: PermissionsScheduleEditorProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<Cadence["kind"]>(schedule.kind);
  const [hour, setHour] = useState<number>(schedule.hour ?? 9);
  const [dayOfWeek, setDayOfWeek] = useState<number>(schedule.dayOfWeek ?? 1);

  const draft = normalize(kind, hour, dayOfWeek);
  const dirty = !sameCadence(draft, schedule);
  const locked = readOnly || status === "RETIRED";

  function save() {
    startTransition(async () => {
      const r = await updateScheduleAction(workerId, draft);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`${workerName} now runs ${r.data.label.toLowerCase()}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-title-3">{scheduleLabel}</p>
        <p className="text-footnote mt-1 text-muted-foreground">
          {status === "ACTIVE" && nextRunAt ? (
            <>
              Next run <RelativeTime iso={nextRunAt} />
            </>
          ) : status === "PAUSED" ? (
            `${workerName} is paused — the schedule resumes when you do.`
          ) : status === "RETIRED" ? (
            `${workerName} is retired.`
          ) : (
            "Runs only when you press Run now."
          )}
        </p>
      </div>

      {locked ? (
        <p className="text-footnote text-muted-foreground">
          {status === "RETIRED"
            ? "A retired worker keeps its history, but the schedule no longer changes."
            : "Your role can see the schedule but not change it. Ask a workspace admin."}
        </p>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="schedule-kind">How often</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as Cadence["kind"])} disabled={pending}>
              <SelectTrigger id="schedule-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {kind === "daily" || kind === "weekly" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {kind === "weekly" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="schedule-day">Day</Label>
                  <Select value={String(dayOfWeek)} onValueChange={(v) => setDayOfWeek(Number(v))} disabled={pending}>
                    <SelectTrigger id="schedule-day" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DAY_LABELS.map((label, i) => (
                        <SelectItem key={label} value={String(i)}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor="schedule-hour">Time</Label>
                <Select value={String(hour)} onValueChange={(v) => setHour(Number(v))} disabled={pending}>
                  <SelectTrigger id="schedule-hour" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {HOURS.map((h) => (
                      <SelectItem key={h} value={String(h)}>
                        {hourLabel(h)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-footnote text-muted-foreground">
              {dirty ? `Will run ${describeCadence(draft).toLowerCase()}` : "No changes"}
            </p>
            <Button variant="secondary" disabled={!dirty || pending} onClick={save}>
              {pending ? "Saving…" : "Save schedule"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
