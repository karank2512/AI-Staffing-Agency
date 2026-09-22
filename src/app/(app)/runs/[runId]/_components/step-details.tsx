"use client";

import Link from "next/link";
import { ArrowRight, FileText } from "lucide-react";
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
 * The expandable body of a timeline row. What it shows depends on the step kind: model calls get their
 * request/response, tool calls their input/output, approvals their decision (or the inline Approve/Decline
 * form while the run waits), deterministic steps their before/after counts.
 */

export interface StepDetailsProps {
  step: RunStepDetailView;
  runId: string;
  runStatus: string;
  workerId: string;
  workerName: string;
}

function Meta({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">{children}</div>;
}

function ModelCallItem({ call }: { call: RunModelCallView }) {
  return (
    <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
      <Meta>
        <span className="font-medium text-foreground">{call.purpose}</span>
        <span className="font-mono">{call.provider}:{call.model}</span>
        <span>{call.tier} tier</span>
        <span className="tabular-nums">{formatTokens(call.inputTokens)} in · {formatTokens(call.outputTokens)} out</span>
        <span className="tabular-nums">{formatUsdPrecise(call.costUsd)}</span>
        <span className="tabular-nums">{formatDuration(call.latencyMs)}</span>
        {call.simulated ? <SimulatedBadge /> : null}
      </Meta>
      {call.error ? <p className="text-sm text-rose-600">{call.error}</p> : null}
      <div className="grid gap-2 lg:grid-cols-2">
        <JsonView label="Request" value={call.request} />
        <JsonView label="Response" value={call.response} />
      </div>
    </div>
  );
}

function ToolCallItem({ call }: { call: RunToolCallView }) {
  const meta = TOOL_CALL_STATUS_META[call.status];
  return (
    <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
      <Meta>
        <span className="font-mono font-medium text-foreground">{call.toolName}</span>
        <span className={cn("inline-flex items-center gap-1.5", TONE_CLASSES[meta.tone].text)}>
          <span className={cn("size-1.5 rounded-full", TONE_CLASSES[meta.tone].dot)} aria-hidden="true" />
          {meta.label}
        </span>
        {call.latencyMs !== null ? <span className="tabular-nums">{formatDuration(call.latencyMs)}</span> : null}
        {call.costUsd > 0 ? <span className="tabular-nums">{formatUsdPrecise(call.costUsd)}</span> : null}
        {call.simulated ? <SimulatedBadge /> : null}
      </Meta>
      {call.error ? <p className="text-sm text-rose-600">{call.error}</p> : null}
      <div className="grid gap-2 lg:grid-cols-2">
        <JsonView label="Input" value={call.input} />
        <JsonView label="Output" value={call.output} />
      </div>
    </div>
  );
}

function ApprovalPanel({ step, runId, runStatus, workerId, workerName }: StepDetailsProps) {
  const approval = step.approval;
  if (!approval) return <p className="text-sm text-muted-foreground">{step.detail ?? "Waiting for a decision."}</p>;
  if (approval.status === "PENDING" && runStatus === "WAITING_FOR_APPROVAL") {
    return <ApprovalDecision runId={runId} workerId={workerId} workerName={workerName} approval={approval} />;
  }
  const verb = approval.status === "APPROVED" ? "Approved" : approval.status === "REJECTED" ? "Declined" : approval.status === "EXPIRED" ? "Expired" : "Pending";
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{approval.title}</p>
      {approval.description ? <p className="text-sm text-pretty text-muted-foreground">{approval.description}</p> : null}
      <p className="text-sm text-muted-foreground">
        {verb}
        {approval.decidedByName ? ` by ${approval.decidedByName}` : ""}
        {approval.decidedAt ? ` · ${formatDateTime(approval.decidedAt)}` : ""}
      </p>
      {approval.decisionNote ? <blockquote className="border-l-2 pl-3 text-sm text-pretty italic text-muted-foreground">“{approval.decisionNote}”</blockquote> : null}
      <JsonView label="Requested action" value={approval.payload} />
    </div>
  );
}

function DeterministicPanel({ step }: { step: RunStepDetailView }) {
  const counts = recordCounts(step.output);
  return (
    <div className="space-y-2">
      {counts ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="metric tabular-nums">{formatNumber(counts.before)}</span>
          <span className="text-muted-foreground">records in</span>
          <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="metric tabular-nums">{formatNumber(counts.after)}</span>
          <span className="text-muted-foreground">out</span>
          {counts.before > counts.after ? <span className="text-xs text-muted-foreground">({formatNumber(counts.before - counts.after)} removed)</span> : null}
        </div>
      ) : null}
      {step.error ? <p className="text-sm text-rose-600">{step.error}</p> : null}
      <div className="grid gap-2 lg:grid-cols-2">
        <JsonView label="Configuration" value={step.input} />
        <JsonView label="Result" value={step.output} />
      </div>
    </div>
  );
}

export function StepDetails(props: StepDetailsProps) {
  const { step } = props;

  switch (step.kind) {
    case "MODEL_CALL":
      return (
        <div className="space-y-2">
          {step.error ? <p className="text-sm text-rose-600">{step.error}</p> : null}
          {step.modelCalls.length === 0 ? <p className="text-sm text-muted-foreground">No model call was recorded for this step.</p> : null}
          {step.modelCalls.map((call) => (
            <ModelCallItem key={call.id} call={call} />
          ))}
        </div>
      );
    case "TOOL_CALL":
      return (
        <div className="space-y-2">
          {step.error ? <p className="text-sm text-rose-600">{step.error}</p> : null}
          {step.toolCalls.length === 0 ? <JsonView label="Input" value={step.input} /> : null}
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
        <div className="flex flex-wrap items-center gap-3">
          {step.detail ? <span className="text-sm text-muted-foreground">{step.detail}</span> : null}
          {id ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`/deliverables/${id}`}>
                <FileText aria-hidden="true" /> Open deliverable
              </Link>
            </Button>
          ) : null}
        </div>
      );
    }
    case "ERROR":
      return <p className="text-sm text-pretty text-rose-600">{step.error ?? step.detail ?? "Something went wrong."}</p>;
    default:
      return (
        <div className="space-y-2">
          {step.error ? <p className="text-sm text-rose-600">{step.error}</p> : null}
          {step.detail ? <p className="text-sm text-muted-foreground">{step.detail}</p> : null}
          {step.output !== null && step.output !== undefined ? <JsonView label="Result" value={step.output} /> : null}
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
