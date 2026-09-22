import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";

export interface BreadcrumbEntry {
  label: string;
  /** Omit on the last (current) entry. */
  href?: string;
}

export interface PageHeaderProps {
  /** Page title. A string in most cases; a node when the title carries an avatar or badge. */
  title: ReactNode;
  /** One sentence of orientation under the title. */
  description?: ReactNode;
  /** Right-aligned controls. Put the single primary `<Button>` last; everything else `variant="outline"`. */
  actions?: ReactNode;
  /** Trail above the title for detail pages: `[{ label: "Workforce", href: "/workforce" }, { label: "Alex" }]`. */
  breadcrumbs?: BreadcrumbEntry[];
  className?: string;
}

/** First element of every page. Owns the only `<h1>` and the spacing to the content below it. */
export function PageHeader({ title, description, actions, breadcrumbs, className }: PageHeaderProps) {
  return (
    <header data-slot="page-header" className={cn("mb-6 flex flex-col gap-3", className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <Breadcrumb>
          <BreadcrumbList className="gap-1 text-[13px] sm:gap-1.5">
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return (
                <Fragment key={`${crumb.label}-${index}`}>
                  <BreadcrumbItem>
                    {crumb.href && !isLast ? (
                      <BreadcrumbLink asChild>
                        <Link href={crumb.href}>{crumb.label}</Link>
                      </BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage className="max-w-[28ch] truncate">{crumb.label}</BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                  {isLast ? null : <BreadcrumbSeparator />}
                </Fragment>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl leading-7 font-semibold tracking-tight text-balance text-foreground">{title}</h1>
          {description ? (
            <p className="max-w-2xl text-sm text-pretty text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
