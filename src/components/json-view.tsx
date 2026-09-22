import { ChevronRight } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { describeJsonShape, safeStringify, tokenizeJson, type JsonTokenKind } from "@/lib/json-highlight";
import { cn } from "@/lib/utils";

export interface JsonViewProps {
  /** Any JSON-serializable value (checkpoint, blueprint, tool input/output, model request). */
  value: unknown;
  /** Summary-row label. Default "JSON". */
  label?: string;
  /** Start expanded. Default collapsed — debug payloads should not dominate a page. */
  defaultOpen?: boolean;
  className?: string;
}

/** Barely-there tinting: enough to find a key, not enough to look like a syntax-highlighter demo. */
const TOKEN_CLASS: Record<JsonTokenKind, string | undefined> = {
  key: "text-foreground",
  string: "text-success",
  number: "text-info",
  literal: "text-muted-foreground",
  plain: undefined,
};

/** Past this size we skip per-token spans (thousands of DOM nodes) and clip what is rendered; Copy stays complete. */
const HIGHLIGHT_LIMIT = 60_000;
const RENDER_LIMIT = 200_000;

/**
 * Collapsible pretty-printed JSON for debug surfaces. Built on native `<details>` so it needs no client state
 * and works inside server components; only the copy button hydrates.
 */
export function JsonView({ value, label = "JSON", defaultOpen = false, className }: JsonViewProps) {
  const text = safeStringify(value);
  const clipped = text.length > RENDER_LIMIT;
  const shown = clipped ? text.slice(0, RENDER_LIMIT) : text;

  return (
    <details data-slot="json-view" open={defaultOpen} className={cn("group/json", className)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 py-1.5 text-footnote font-medium text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-3.5 shrink-0 transition-transform duration-[240ms] ease-standard group-open/json:rotate-90"
          aria-hidden="true"
        />
        <span className="truncate text-foreground">{label}</span>
        <span className="truncate font-mono text-caption font-normal text-tertiary">{describeJsonShape(value)}</span>
        <span className="ml-auto flex shrink-0 items-center">
          <CopyButton value={text} />
        </span>
      </summary>
      <pre className="max-h-[28rem] overflow-auto rounded-lg bg-muted p-4 font-mono text-[13px] leading-5 text-muted-foreground">
        <code>
          {shown.length <= HIGHLIGHT_LIMIT
            ? tokenizeJson(shown).map((token, i) =>
                token.kind === "plain" ? (
                  token.text
                ) : (
                  <span key={i} className={TOKEN_CLASS[token.kind]}>
                    {token.text}
                  </span>
                ),
              )
            : shown}
          {clipped ? "\n… truncated for display — use Copy for the full value" : null}
        </code>
      </pre>
    </details>
  );
}
