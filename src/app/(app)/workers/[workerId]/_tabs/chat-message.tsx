"use client";

import Link from "next/link";
import { ArrowUpRight, Check, Loader2 } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { RelativeTime } from "@/components/relative-time";
import { SimulatedBadge } from "@/components/simulated-badge";
import { Button } from "@/components/ui/button";
import { WorkerAvatar } from "@/components/worker-avatar";
import { TONE_CLASSES } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { ChatMessageView } from "@/server/queries/worker-manage";

/** How a message reads to the manager: the worker either answers, remembers for next time, or asks to change. */
export const CLASSIFICATION_META: Record<NonNullable<ChatMessageView["classification"]>, { label: string; className: string }> = {
  QUESTION: { label: "Question", className: TONE_CLASSES.running.badge },
  TEMPORARY_INSTRUCTION: { label: "One-off instruction", className: TONE_CLASSES.attention.badge },
  SPEC_CHANGE: { label: "Permanent change", className: "border-primary/20 bg-primary/5 text-primary" },
};

export interface ChatMessageProps {
  message: ChatMessageView;
  worker: { name: string; avatarColor: string };
  /** Local echo of a message whose send is still in flight. */
  pending?: boolean;
}

export function ChatMessage({ message, worker, pending = false }: ChatMessageProps) {
  if (message.role === "USER") return <UserBubble message={message} pending={pending} />;
  return <WorkerBubble message={message} worker={worker} />;
}

function UserBubble({ message, pending }: { message: ChatMessageView; pending: boolean }) {
  const meta = message.classification ? CLASSIFICATION_META[message.classification] : null;
  return (
    <div className="flex justify-end">
      <div className="flex max-w-[85%] flex-col items-end gap-1 sm:max-w-[70%]">
        <div className={cn("rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-pretty whitespace-pre-wrap text-primary-foreground", pending && "opacity-70")}>
          {message.content}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {pending ? (
            <>
              <Loader2 className="size-3 animate-spin" aria-hidden="true" /> Sending…
            </>
          ) : (
            <>
              {meta ? <span className={cn("inline-flex h-4.5 items-center rounded-full border px-1.5 font-medium", meta.className)}>{meta.label}</span> : null}
              <RelativeTime iso={message.createdAt} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function WorkerBubble({ message, worker }: { message: ChatMessageView; worker: { name: string; avatarColor: string } }) {
  const proposalOpen = message.href !== null && (message.proposalStatus === null || message.proposalStatus === "PROPOSED");
  return (
    <div className="flex items-end gap-2">
      <WorkerAvatar name={worker.name} color={worker.avatarColor} size="sm" className="mb-5 shrink-0" />
      <div className="flex max-w-[85%] flex-col items-start gap-1 sm:max-w-[75%]">
        <div className="rounded-2xl rounded-bl-md border bg-card px-3.5 py-2 text-sm ring-1 ring-foreground/5">
          <Markdown content={message.content} className="text-sm [&_p]:my-0 [&_p+p]:mt-2" />
          {message.href ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t pt-2.5">
              {proposalOpen ? (
                <Button size="sm" asChild>
                  <Link href={message.href}>
                    Review proposed change <ArrowUpRight aria-hidden="true" />
                  </Link>
                </Button>
              ) : (
                <>
                  <span className={cn("inline-flex items-center gap-1 text-xs font-medium", message.proposalStatus === "ACTIVE" || message.proposalStatus === "REPLACED" ? TONE_CLASSES.success.text : "text-muted-foreground")}>
                    {message.proposalStatus === "ACTIVE" || message.proposalStatus === "REPLACED" ? (
                      <>
                        <Check className="size-3.5" aria-hidden="true" /> Applied as version {message.proposedVersion ?? "—"}
                      </>
                    ) : (
                      "Proposal declined"
                    )}
                  </span>
                  <Button size="sm" variant="ghost" asChild>
                    <Link href={message.href}>View</Link>
                  </Button>
                </>
              )}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground/70">{worker.name}</span>
          <RelativeTime iso={message.createdAt} />
          {message.simulated ? <SimulatedBadge className="h-4.5 px-1.5 text-[10px]" /> : null}
        </div>
      </div>
    </div>
  );
}

/** The worker's "typing" indicator while a reply is being composed. */
export function ChatTyping({ worker }: { worker: { name: string; avatarColor: string } }) {
  return (
    <div className="flex items-end gap-2" aria-live="polite">
      <WorkerAvatar name={worker.name} color={worker.avatarColor} size="sm" className="mb-5 shrink-0" />
      <div className="flex flex-col items-start gap-1">
        <div className="flex items-center gap-1 rounded-2xl rounded-bl-md border bg-card px-3.5 py-2.5 ring-1 ring-foreground/5">
          <span className="sr-only">{worker.name} is thinking</span>
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: `${i * 120}ms` }} aria-hidden="true" />
          ))}
        </div>
        <span className="text-[11px] text-muted-foreground">{worker.name} is thinking…</span>
      </div>
    </div>
  );
}
