"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Lightbulb, MessageSquare, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { WorkerAvatar } from "@/components/worker-avatar";
import { cn } from "@/lib/utils";
import type { ChatMessageView, WorkerChatView } from "@/server/queries/worker-manage";
import { sendMessageAction } from "../manage-actions";
import { ChatMessage, ChatTyping } from "./chat-message";

/** One of each kind, so the first click shows what the worker can do. */
const SUGGESTIONS: ReadonlyArray<{ text: string; kind: "question" | "instruction" | "change" }> = [
  { text: "What did you do in your last run?", kind: "question" },
  { text: "This time, focus on European companies", kind: "instruction" },
  { text: "From now on, include the lead investor for every round", kind: "change" },
];

const MESSAGE_MAX_CHARS = 4_000;

interface PendingSend {
  id: string;
  content: string;
}

export interface ChatPanelProps {
  worker: WorkerChatView["worker"];
  messages: ChatMessageView[];
  pendingInstructions: number;
}

export function ChatPanel({ worker, messages, pendingInstructions }: ChatPanelProps) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingSend | null>(null);
  // Messages the server has not rendered yet (a send just finished); dropped once they arrive via props.
  const [extra, setExtra] = useState<ChatMessageView[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const all = useMemo(() => {
    const seen = new Set(messages.map((m) => m.id));
    return [...messages, ...extra.filter((m) => !seen.has(m.id))];
  }, [messages, extra]);

  // Keep the newest message in view without scrolling the page itself (scrollIntoView would move the window too).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [all.length, pending]);

  const retired = worker.status === "RETIRED";
  const canSend = draft.trim().length > 0 && draft.length <= MESSAGE_MAX_CHARS && pending === null && !retired;

  async function send(text: string) {
    const content = text.trim();
    if (content.length === 0 || pending || retired) return;
    const local: PendingSend = { id: `pending-${Date.now()}`, content };
    setPending(local);
    setDraft("");
    const r = await sendMessageAction(worker.id, content);
    setPending(null);
    if (!r.ok) {
      setDraft(content);
      toast.error(r.error);
      return;
    }
    setExtra((prev) => [...prev, ...r.data.messages]);
    if (r.data.classification === "SPEC_CHANGE" && r.data.href) {
      toast.success(`${worker.name} drafted a proposed change`, { description: "Review it before it takes effect." });
    } else if (r.data.classification === "TEMPORARY_INSTRUCTION") {
      toast.success(`${worker.name} will apply this on the next run`);
    }
    router.refresh();
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(draft);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(draft);
    }
  }

  function applySuggestion(text: string) {
    setDraft(text);
    textareaRef.current?.focus();
  }

  return (
    <Card className="overflow-hidden py-0">
      <div className="flex items-center gap-3 border-b bg-muted/30 px-4 py-3">
        <WorkerAvatar name={worker.name} color={worker.avatarColor} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{worker.name}</p>
          <p className="truncate text-xs text-muted-foreground">{worker.title}</p>
        </div>
        {pendingInstructions > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
            <Lightbulb className="size-3" aria-hidden="true" />
            {pendingInstructions === 1 ? "1 instruction queued for the next run" : `${pendingInstructions} instructions queued for the next run`}
          </span>
        ) : null}
      </div>

      <CardContent ref={scrollRef} className="max-h-[60vh] min-h-[22rem] overflow-y-auto px-4 py-5">
        {all.length === 0 && !pending ? (
          <div className="flex h-full min-h-[18rem] flex-col items-center justify-center gap-3 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-muted">
              <MessageSquare className="size-5 text-muted-foreground" aria-hidden="true" />
            </span>
            <div className="space-y-1">
              <p className="text-sm font-medium">Talk to {worker.name} like a colleague</p>
              <p className="max-w-sm text-xs text-pretty text-muted-foreground">
                Ask what they did, adjust the next run, or change how they work for good. Lasting changes come back as a proposal for
                you to approve.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {all.map((m) => (
              <ChatMessage key={m.id} message={m} worker={worker} />
            ))}
            {pending ? (
              <>
                <ChatMessage
                  message={{
                    id: pending.id,
                    role: "USER",
                    content: pending.content,
                    classification: null,
                    createdAt: new Date().toISOString(),
                    simulated: false,
                    proposedVersionId: null,
                    proposedVersion: null,
                    proposalStatus: null,
                    href: null,
                    normalizedInstruction: null,
                  }}
                  worker={worker}
                  pending
                />
                <ChatTyping worker={worker} />
              </>
            ) : null}
          </div>
        )}
      </CardContent>

      <form onSubmit={onSubmit} className="space-y-3 border-t bg-muted/20 px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.text}
              type="button"
              disabled={pending !== null || retired}
              onClick={() => applySuggestion(s.text)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground disabled:opacity-50",
              )}
            >
              <Sparkles className="size-3" aria-hidden="true" />
              {s.text}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={pending !== null || retired}
            placeholder={retired ? `${worker.name} has been retired and no longer takes messages.` : `Message ${worker.name}…`}
            aria-label={`Message ${worker.name}`}
            rows={2}
            maxLength={MESSAGE_MAX_CHARS}
            className="min-h-10 flex-1 resize-none bg-card"
          />
          <Button type="submit" size="icon" disabled={!canSend} aria-label="Send message">
            <Send aria-hidden="true" />
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">Enter to send · Shift+Enter for a new line</p>
      </form>
    </Card>
  );
}
