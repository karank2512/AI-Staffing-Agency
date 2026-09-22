import type { MockTextResponse } from "@/server/models/types";
import type { MockAgentTurnInput } from "@/server/simulation/types";
import { clip } from "../text";
import { Conversation, isPlainRecord, toolTurn } from "./conversation";
import { parseAgentInput } from "./input";
import { collectInstructions } from "./job";

/**
 * Notifier rule (contract): when `send_notification` is granted and has not been called yet, emit exactly one
 * call — channel email, recipients from the spec/brief (else team@acme.example), subject = deliverable title,
 * body = the first 1,500 chars of the input. After its result, ok OR error, answer in one line. The runtime
 * pauses the run for approval between the call and its result; this brain is stateless, so it just re-reads
 * the conversation when resumed.
 */

const DEFAULT_RECIPIENTS = ["team@acme.example"];
const BODY_CHARS = 1_500;
const MAX_RECIPIENTS = 20;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;

/** Addresses named in the spec or instructions — never ones that merely appear in the content being sent. */
export function recipientsFor(input: MockAgentTurnInput): string[] {
  const sources = [JSON.stringify(input.spec), input.jobBrief, input.component.instructions, input.component.goal, ...collectInstructions(input)];
  const found = new Set<string>();
  for (const s of sources) for (const m of s.matchAll(EMAIL_RE)) found.add(m[0].toLowerCase());
  const list = [...found].slice(0, MAX_RECIPIENTS);
  return list.length > 0 ? list : DEFAULT_RECIPIENTS;
}

function bodyFor(input: MockAgentTurnInput): string {
  const parsed = parseAgentInput(input.messages, input.component.inputKeys);
  const primary = input.component.inputKeys.map((k) => parsed.sections[k]).find((s) => s !== undefined && s.trim().length > 0);
  const text = (primary ?? parsed.raw).trim();
  return clip(text.length > 0 ? text : "Your report is ready.", BODY_CHARS);
}

function deliveredCount(output: unknown, fallback: number): number {
  return isPlainRecord(output) && typeof output.recipients === "number" ? output.recipients : fallback;
}

export function notifierTurn(input: MockAgentTurnInput): MockTextResponse {
  const convo = new Conversation(input.messages, input.tools, input.component.maxTurns);
  const subject = clip(input.spec.deliverable.title.trim() || "Your report", 200);
  const attempts = convo.state.exchanges.filter((e) => e.name === "send_notification");

  if (attempts.length === 0) {
    const recipients = recipientsFor(input);
    if (convo.remainingTurns >= 2) {
      const turn = toolTurn(convo, `Sending "${subject}" to ${recipients.length === 1 ? recipients[0] : `${recipients.length} recipients`}.`, [
        { name: "send_notification", input: { channel: "email", recipients, subject, body: bodyFor(input) } },
      ]);
      if (turn) return turn;
    }
    return { text: `I was not able to send "${subject}" this run; it is available in the deliverable.` };
  }

  const last = attempts[attempts.length - 1];
  if (!last.answered) return { text: `"${subject}" is waiting for approval before it goes out.` };
  if (last.isError) return { text: `The notification for "${subject}" could not be sent (${last.errorMessage ?? "unknown error"}); the deliverable is still available in the workspace.` };
  const requested = isPlainRecord(last.input) && Array.isArray(last.input.recipients) ? last.input.recipients.length : 1;
  const n = deliveredCount(last.output, requested);
  return { text: `Sent "${subject}" by email to ${n} recipient${n === 1 ? "" : "s"}.` };
}
