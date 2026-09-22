import { Fragment } from "react";
import { JsonView } from "@/components/json-view";
import { cn } from "@/lib/utils";
import { clip, summarizePayload } from "./request";

export interface PayloadPreviewProps {
  /** The exact tool input awaiting a decision. */
  payload: unknown;
  /** "Maya" — whose words these are. */
  workerName: string;
  /** Tighter spacing and a shorter excerpt: the Workforce band and the confirm dialog. */
  compact?: boolean;
  className?: string;
}

/**
 * What will actually happen, in an inset panel: recipients, subject and the first lines of the message, with
 * "Show full" for the rest. Nobody approves a send without having seen who it goes to.
 */
export function PayloadPreview({ payload, workerName, compact = false, className }: PayloadPreviewProps) {
  const { fields, body, complex } = summarizePayload(payload);
  if (fields.length === 0 && body === null && !complex) return null;

  const excerpt = body === null ? null : clip(body, compact ? 150 : 320);
  const hasMore = body !== null && excerpt !== body;

  return (
    <div className={cn("rounded-lg bg-muted text-left", compact ? "p-3.5" : "p-4", className)}>
      {fields.length > 0 ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
          {fields.map((field) => (
            <Fragment key={field.label}>
              <dt className="text-footnote text-muted-foreground">{field.label}</dt>
              <dd
                className={cn(
                  "text-callout min-w-0 break-words text-foreground",
                  field.emphasis ? "font-medium" : undefined,
                )}
              >
                {field.value}
              </dd>
            </Fragment>
          ))}
        </dl>
      ) : null}

      {excerpt ? (
        <p className={cn("text-callout text-pretty text-muted-foreground", fields.length > 0 ? "mt-3" : undefined)}>
          {excerpt}
        </p>
      ) : null}

      {hasMore && body ? (
        <details className="group/full mt-2">
          <summary className="text-footnote w-fit cursor-pointer list-none text-link outline-none hover:underline [&::-webkit-details-marker]:hidden">
            <span className="group-open/full:hidden">
              Show full message <span aria-hidden="true">›</span>
            </span>
            <span className="hidden group-open/full:inline">Hide the rest</span>
          </summary>
          <p className="text-callout mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap text-pretty text-muted-foreground">
            {body}
          </p>
        </details>
      ) : null}

      {complex ? (
        <JsonView value={payload} label={`Everything ${workerName} passed`} className="mt-2" />
      ) : null}
    </div>
  );
}
