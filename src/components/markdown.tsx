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
  /**
   * `article` (default) is the 17px reading view used for deliverables. `compact` is the 15px version for
   * chat replies, review narratives and anything inside a dense card.
   */
  variant?: "article" | "compact";
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
  1: "mt-10 mb-4 text-[2em] leading-[1.2] font-semibold tracking-[-0.02em] text-balance text-foreground",
  2: "mt-10 mb-3 text-[1.294em] leading-[1.27] font-semibold tracking-[-0.012em] text-balance text-foreground",
  3: "mt-7 mb-2 text-[1em] leading-[1.35] font-semibold tracking-[-0.022em] text-foreground",
  4: "mt-6 mb-2 text-[1em] leading-[1.35] font-medium text-foreground",
  5: "mt-5 mb-1.5 text-[0.88em] leading-[1.4] font-semibold text-muted-foreground",
  6: "mt-5 mb-1.5 text-[0.88em] leading-[1.4] font-medium text-muted-foreground",
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
            className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.82em] text-foreground"
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
            className="break-words text-link underline-offset-[0.15em] hover:underline"
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
            "mt-1 flex size-4 shrink-0 items-center justify-center rounded-[5px] border",
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
          <p key={i} className={nested ? "my-2" : "my-4 text-pretty"}>
            {renderInline(block.children)}
          </p>
        );
      case "list": {
        const className = cn(
          "space-y-2 pl-6 marker:text-tertiary",
          nested ? "my-2" : "my-4",
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
          <div key={i} className="my-5 overflow-hidden rounded-lg bg-muted">
            {block.lang ? (
              <div className="px-4 pt-3 font-mono text-caption text-tertiary">{block.lang}</div>
            ) : null}
            <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-5 text-foreground">
              <code>{block.value}</code>
            </pre>
          </div>
        );
      case "table":
        return (
          <div key={i} className="my-5 overflow-x-auto rounded-lg bg-card">
            <table className="w-full border-collapse text-left text-[15px] leading-6">
              <thead>
                <tr className="border-b border-border">
                  {block.header.map((cell, c) => (
                    <th
                      key={c}
                      scope="col"
                      className={cn(
                        "h-11 px-4 text-[13px] font-semibold whitespace-nowrap text-muted-foreground",
                        alignClass(block.align[c]),
                      )}
                    >
                      {renderInline(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {block.rows.map((row, r) => (
                  <tr key={r} className="transition-colors duration-200 hover:bg-[#f9f9fb]">
                    {row.map((cell, c) => (
                      <td
                        key={c}
                        className={cn(
                          "min-w-24 px-4 py-3 align-top tabular-nums",
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
            className="my-5 border-l-[3px] border-input pl-5 text-muted-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
          >
            {renderBlocks(block.children)}
          </blockquote>
        );
      case "hr":
        return <hr key={i} className="my-8 border-border" />;
    }
  });
}

/**
 * Safe, minimal Markdown renderer. Parses with `parseMarkdown` (src/lib/markdown.ts) and maps the AST to React
 * elements — there is no HTML string and no `dangerouslySetInnerHTML`, so model output can never inject markup.
 * Works in server and client components.
 */
export function Markdown({ content, variant = "article", className }: MarkdownProps) {
  const blocks = parseMarkdown(content);
  if (blocks.length === 0) return null;
  return (
    <div
      data-slot="markdown"
      data-variant={variant}
      className={cn(
        "leading-[1.6] break-words text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        variant === "article" ? "max-w-[720px] text-[17px] tracking-[-0.022em]" : "max-w-none text-[15px]",
        className,
      )}
    >
      {renderBlocks(blocks)}
    </div>
  );
}
