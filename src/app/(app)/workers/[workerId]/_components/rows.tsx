import type { ReactNode } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The profile's one list idiom: a white card of rows separated by hairlines inset from the card edge — never a
 * nested bordered box, never a card per row. Rows lead with a human sentence and demote metadata to the right.
 */

/** Hairline between rows, drawn as an inset pseudo-element so the hover fill still spans the full width. */
const HAIRLINE =
  "[&:not(:first-child)]:before:absolute [&:not(:first-child)]:before:inset-x-5 [&:not(:first-child)]:before:top-0 [&:not(:first-child)]:before:h-px [&:not(:first-child)]:before:bg-border sm:[&:not(:first-child)]:before:inset-x-6";

export function RowList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Card className={cn("gap-0 py-0", className)}>
      <ul role="list" className="flex flex-col">
        {children}
      </ul>
    </Card>
  );
}

export interface RowProps {
  children: ReactNode;
  /** Makes the whole row the link target. */
  href?: string;
  className?: string;
}

export function Row({ children, href, className }: RowProps) {
  const inner = (
    <div className={cn("flex min-h-14 w-full items-start gap-4 px-5 py-3.5 sm:px-6", className)}>{children}</div>
  );
  return (
    <li className={cn("relative", HAIRLINE)}>
      {href ? (
        <Link href={href} className="group/row block rounded-none transition-colors duration-200 hover:bg-muted">
          {inner}
        </Link>
      ) : (
        inner
      )}
    </li>
  );
}

/** Primary line of a row: the sentence. Turns blue on hover when the row navigates. */
export function RowTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("min-w-0 text-[15px] font-medium text-pretty group-hover/row:text-link", className)}>
      {children}
    </p>
  );
}

/** Secondary line: 13px metadata, with `·` between parts. */
export function RowMeta({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("text-footnote mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground", className)}>
      {children}
    </p>
  );
}

export function Sep() {
  return (
    <span aria-hidden="true" className="text-tertiary">
      ·
    </span>
  );
}

/** Right-hand numeric column of a row: fixed-width digits so nothing jitters between rows. */
export function RowValue({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("metric text-footnote shrink-0 text-right text-muted-foreground", className)}>{children}</span>;
}
