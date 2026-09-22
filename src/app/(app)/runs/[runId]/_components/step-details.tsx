"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { JsonView } from "@/components/json-view";
import { SimulatedBadge } from "@/components/simulated-badge";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatDuration, formatNumber, formatTokens, formatUsdPrecise } from "@/lib/format";
import { TONE_CLASSES } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { RunModelCallView, RunStepDetailView, RunToolCallView } from "@/server/queries/runs";
import { ApprovalDecision } from "./approval-decision";
import { deliverableIdOf, recordCounts, TOOL_CALL_STATUS_META } from "./step-meta";

/**
 * The expandable body of a timeline row, rendered in one flat inset panel: no boxes inside boxes, just
 * hairlines between entries. What it shows depends on the step kind — model calls get their request and
 * response, tool calls their input and output, approvals the decision (or the inline Approve / Decline while
 * the run waits), deterministic steps their before-and-after counts.
 */

export interface StepDetailsProps {
  step: RunStepDetailView;
  runId: string;
  runStatus: string;
  workerId: string;
  workerName: string;
  canDecide?: boolean;
}

/** JSON blocks sit on the white card colour so they read as insets inside the already-gray panel. */
const JSON_ON_PANEL = "[&_pre]:bg-card";

function Meta({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-footnote text-muted-foreground">{children}</div>;
}

function Entry({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("space-y-2.5 border-b border-border pb-4 last:border-0 last:pb-0", className)}>{children}</div>;
}

function ModelCallItem({ call }: { call: RunModelCallView }) {
  return (
    <Entry>
      <Meta>
        <span className="font-medium text-foreground">{call.purpose}</span>
        <span className="font-mono">
          {call.provider}:{call.model}
        </span>
        <span>{call.tier} tier</span>
        <span className="metric">
          {formatTokens(call.inputTokens)} in · {formatTokens(call.outputTokens)} out
        </span>
        <span className="metric">{formatUsdPrecise(call.costUsd)}</span>
        <span className="metric">{formatDuration(call.latencyMs)}</span>
        {call.simulated ? <SimulatedBadge /> : null}
      </Meta>
      {call.error ? <p className="text-[15px] text-danger">{call.error}</p> : null}
      <div className="grid gap-2 lg:grid-cols-2">
        <JsonView label="What we asked" value={call.request} className={JSON_ON_PANEL} />
        <JsonView label="What came back" value={call.response} className={JSON_ON_PANEL} />
      </div>
    </Entry>
  );
}

function ToolCallItem({ call }: { call: RunToolCallView }) {
  const meta = TOOL_CALL_STATUS_META[call.status];
  return (
    <Entry>
      <Meta>
        <span className="font-mono font-medium text-foreground">{call.toolName}</span>
        <span className={cn("inline-flex items-center gap-1.5", TONE_CLASSES[meta.tone].text)}>
          <span className={cn("size-[7px] rounded-full", TONE_CLASSES[meta.tone].dot)} aria-hidden="true" />
          {meta.label}
        </span>
        {call.latencyMs !== null ? <span className="metric">{formatDuration(call.latencyMs)}</span> : null}
        {call.costUsd > 0 ? <span className="metric">{formatUsdPrecise(call.costUsd)}</span> : null}
        {call.simulated ? <SimulatedBadge /> : null}
      </Meta>
      {call.error ? <p className="text-[15px] text-danger">{call.error}</p> : null}
      <div className="grid gap-2 lg:grid-cols-2">
        <JsonView label="Input" value={call.input} className={JSON_ON_PANEL} />
        <JsonView label="Output" value={call.output} className={JSON_ON_PANEL} />
      </div>
    </Entry>
  );
}

function ApprovalPanel({ step, runId, runStatus, workerId, workerName, canDecide }: StepDetailsProps) {
  const approval = step.approval;
  if (!approval) return <p className="text-[15px] text-muted-foreground">{step.detail ?? "Waiting for a decision."}</p>;
  if (approval.status === "PENDING" && runStatus === "WAITING_FOR_APPROVAL") {
    return (
      <ApprovalDecision runId={runId} workerId={workerId} workerName={workerName} approval={approval} canDecide={canDecide} />
    );
  }
  const verb =
    approval.status === "APPROVED"
      ? "You approved it"
      : approval.status === "REJECTED"
        ? "You declined it"
        : approval.status === "EXPIRED"
          ? "The request expired"
          : "Still pending";
  return (
    <div className="space-y-2.5">
      <p className="text-title-3 text-pretty">{approval.title}</p>
      {approval.description ? <p className="text-[15px] text-pretty text-muted-foreground">{approval.description}</p> : null}
      <p className="text-footnote text-muted-foreground">
        {verb}
        {approval.decidedByName ? ` · ${approval.decidedByName}` : ""}
        {approval.decidedAt ? ` · ${formatDateTime(approval.decidedAt)}` : ""}
      </p>
      {approval.decisionNote ? (
        <blockquote className="border-l-[3px] border-input pl-4 text-[15px] text-pretty text-muted-foreground">
          “{approval.decisionNote}”
        </blockquote>
      ) : null}
      <JsonView label="What was requested" value={approval.payload} className={JSON_ON_PANEL} />
    </div>
  );
}

function DeterministicPanel({ step }: { step: RunStepDetailView }) {
  const counts = recordCounts(step.output);
  return (
    <div className="space-y-2.5">
      {counts ? (
        <p className="text-[15px]">
          <span className="metric font-medium">{formatNumber(counts.before)}</span>
          <span className="text-muted-foreground"> records in, </span>
          <span className="metric font-medium">{formatNumber(counts.after)}</span>
          <span className="text-muted-foreground">
            {" "}
            out{counts.before > counts.after ? ` — ${formatNumber(counts.before - counts.after)} dropped` : ""}
          </span>
        </p>
      ) : null}
      {step.error ? <p className="text-[15px] text-danger">{step.error}</p> : null}
      <div className="grid gap-2 lg:grid-cols-2">
        <JsonView label="Configuration" value={step.input} className={JSON_ON_PANEL} />
        <JsonView label="Result" value={step.output} className={JSON_ON_PANEL} />
      </div>
    </div>
  );
}

export function StepDetails(props: StepDetailsProps) {
  const { step } = props;

  switch (step.kind) {
    case "MODEL_CALL":
      return (
        <div className="space-y-4">
          {step.error ? <p className="text-[15px] text-danger">{step.error}</p> : null}
          {step.modelCalls.length === 0 ? (
            <p className="text-[15px] text-muted-foreground">No model call was recorded for this step.</p>
          ) : null}
          {step.modelCalls.map((call) => (
            <ModelCallItem key={call.id} call={call} />
          ))}
        </div>
      );
    case "TOOL_CALL":
      return (
        <div className="space-y-4">
          {step.error ? <p className="text-[15px] text-danger">{step.error}</p> : null}
          {step.toolCalls.length === 0 ? <JsonView label="Input" value={step.input} className={JSON_ON_PANEL} /> : null}
          {step.toolCalls.map((call) => (
            <ToolCallItem key={call.id} call={call} />
          ))}
        </div>
      );
    case "APPROVAL":
      return <ApprovalPanel {...props} />;
    case "DETERMINISTIC":
      return <DeterministicPanel step={step} />;
    case "DELIVERABLE": {
      const id = deliverableIdOf(step.output);
      return (
        <div className="flex flex-wrap items-center gap-4">
          {step.detail ? <span className="text-[15px] text-muted-foreground">{step.detail}</span> : null}
          {id ? (
            <Button asChild variant="link">
              <Link href={`/deliverables/${id}`}>
                Read the deliverable <ChevronRight data-icon="inline-end" aria-hidden="true" />
              </Link>
            </Button>
          ) : null}
        </div>
      );
    }
    case "ERROR":
      return <p className="text-[15px] text-pretty text-danger">{step.error ?? step.detail ?? "Something went wrong."}</p>;
    default:
      return (
        <div className="space-y-2.5">
          {step.error ? <p className="text-[15px] text-danger">{step.error}</p> : null}
          {step.detail ? <p className="text-[15px] text-muted-foreground">{step.detail}</p> : null}
          {step.output !== null && step.output !== undefined ? (
            <JsonView label="Result" value={step.output} className={JSON_ON_PANEL} />
          ) : null}
        </div>
      );
  }
}

/** Whether a row has anything worth expanding. Rows that only exist in the live poll (no detail yet) don't. */
export function hasDetails(step: RunStepDetailView | undefined): step is RunStepDetailView {
  if (!step) return false;
  if (step.modelCalls.length > 0 || step.toolCalls.length > 0 || step.approval || step.error) return true;
  if (step.kind === "DELIVERABLE" || step.kind === "DETERMINISTIC") return true;
  return step.output !== null && step.output !== undefined;
}
