import type { ReactNode } from "react";
import { Check } from "lucide-react";
import {
  isExternalHref,
  parseMarkdown,
  type BlockNode,
  type InlineNode,
  type ListItemNode,
  type TableAlign,
} from "@/lib/markdown";
import { cn } from "@/lib/utils";

export interface MarkdownProps {
  /** Markdown source (deliverable report, review narrative, chat reply). `null`/empty renders nothing. */
  content: string | null | undefined;
  className?: string;
}

const ALIGN_CLASS: Record<NonNullable<TableAlign>, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

function alignClass(align: TableAlign | undefined): string | null {
  return align ? ALIGN_CLASS[align] : null;
}

const HEADING_CLASS: Record<1 | 2 | 3 | 4 | 5 | 6, string> = {
  1: "mt-7 mb-3 text-lg leading-7 font-semibold tracking-tight text-foreground",
  2: "mt-7 mb-2.5 text-base leading-6 font-semibold tracking-tight text-foreground",
  3: "mt-5 mb-2 text-sm leading-6 font-semibold text-foreground",
  4: "mt-4 mb-1.5 text-sm leading-6 font-medium text-foreground",
  5: "mt-4 mb-1.5 text-[13px] leading-5 font-medium text-muted-foreground",
  6: "mt-4 mb-1.5 text-xs leading-5 font-medium tracking-wide text-muted-foreground uppercase",
};

function renderInline(nodes: InlineNode[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return node.value;
      case "br":
        return <br key={i} />;
      case "strong":
        return (
          <strong key={i} className="font-semibold text-foreground">
            {renderInline(node.children)}
          </strong>
        );
      case "em":
        return <em key={i}>{renderInline(node.children)}</em>;
      case "del":
        return (
          <del key={i} className="text-muted-foreground">
            {renderInline(node.children)}
          </del>
        );
      case "code":
        return (
          <code
            key={i}
            className="rounded-[5px] border border-border/70 bg-muted/70 px-1 py-px font-mono text-[0.86em] text-foreground"
          >
            {node.value}
          </code>
        );
      case "link": {
        const external = isExternalHref(node.href);
        return (
          <a
            key={i}
            href={node.href}
            {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}
            className="font-medium break-words text-primary underline decoration-primary/30 underline-offset-[3px] transition-colors hover:decoration-primary"
          >
            {renderInline(node.children)}
          </a>
        );
      }
    }
  });
}

function renderListItem(item: ListItemNode, key: number): ReactNode {
  const isTask = item.checked !== null;
  return (
    <li key={key} className={cn("pl-1", isTask && "-ml-5 flex list-none items-start gap-2 pl-0")}>
      {isTask ? (
        <span
          role="checkbox"
          aria-checked={item.checked === true}
          aria-disabled="true"
          className={cn(
            "mt-1 flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border",
            item.checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background",
          )}
        >
          {item.checked ? <Check className="size-2.5" strokeWidth={3.5} aria-hidden="true" /> : null}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        {renderInline(item.children)}
        {item.blocks.length > 0 ? <div className="mt-1.5">{renderBlocks(item.blocks, true)}</div> : null}
      </div>
    </li>
  );
}

function renderBlocks(blocks: BlockNode[], nested = false): ReactNode[] {
  return blocks.map((block, i) => {
    switch (block.type) {
      case "heading": {
        const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
        return (
          <Tag key={i} className={HEADING_CLASS[block.level]}>
            {renderInline(block.children)}
          </Tag>
        );
      }
      case "paragraph":
        return (
          <p key={i} className={nested ? "my-1.5" : "my-3"}>
            {renderInline(block.children)}
          </p>
        );
      case "list": {
        const className = cn(
          "space-y-1.5 pl-5 marker:text-muted-foreground/80",
          nested ? "my-1.5" : "my-3",
          block.ordered ? "list-decimal marker:font-medium marker:tabular-nums" : "list-disc",
        );
        const items = block.items.map(renderListItem);
        return block.ordered ? (
          <ol key={i} start={block.start !== 1 ? block.start : undefined} className={className}>
            {items}
          </ol>
        ) : (
          <ul key={i} className={className}>
            {items}
          </ul>
        );
      }
      case "code":
        return (
          <div key={i} className="my-4 overflow-hidden rounded-lg border border-border bg-slate-50">
            {block.lang ? (
              <div className="border-b border-border/70 px-3 py-1 font-mono text-[11px] text-muted-foreground">
                {block.lang}
              </div>
            ) : null}
            <pre className="overflow-x-auto p-3 font-mono text-[12.5px] leading-5 text-slate-800">
              <code>{block.value}</code>
            </pre>
          </div>
        );
      case "table":
        return (
          <div key={i} className="my-4 overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full border-collapse text-left text-[13px] leading-5">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  {block.header.map((cell, c) => (
                    <th
                      key={c}
                      scope="col"
                      className={cn(
                        "px-3 py-2 text-xs font-medium whitespace-nowrap text-muted-foreground",
                        alignClass(block.align[c]),
                      )}
                    >
                      {renderInline(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {block.rows.map((row, r) => (
                  <tr key={r} className="transition-colors hover:bg-muted/40">
                    {row.map((cell, c) => (
                      <td
                        key={c}
                        className={cn(
                          "min-w-24 px-3 py-2 align-top tabular-nums",
                          alignClass(block.align[c]),
                        )}
                      >
                        {renderInline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "blockquote":
        return (
          <blockquote
            key={i}
            className="my-4 border-l-2 border-primary/30 pl-4 text-muted-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
          >
            {renderBlocks(block.children)}
          </blockquote>
        );
      case "hr":
        return <hr key={i} className="my-6 border-border" />;
    }
  });
}

/**
 * Safe, minimal Markdown renderer. Parses with `parseMarkdown` (src/lib/markdown.ts) and maps the AST to React
 * elements — there is no HTML string and no `dangerouslySetInnerHTML`, so model output can never inject markup.
 * Works in server and client components.
 */
export function Markdown({ content, className }: MarkdownProps) {
  const blocks = parseMarkdown(content);
  if (blocks.length === 0) return null;
  return (
    <div
      data-slot="markdown"
      className={cn(
        "max-w-none text-sm leading-6 break-words text-foreground/90 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
    >
      {renderBlocks(blocks)}
    </div>
  );
}
