import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SETTINGS_SECTIONS, settingsHref, type SettingsSectionId } from "../sections";

/**
 * Desktop: a plain text list on the canvas, the current section in a white pill — the system-preferences
 * shape from docs/DESIGN.md. It sticks under the global nav so long sections keep their bearings.
 */
export function SettingsRail({ active }: { active: SettingsSectionId }) {
  return (
    <nav aria-label="Settings sections" className="hidden lg:block">
      <ul className="sticky top-[calc(var(--nav-height)+40px)] space-y-0.5">
        {SETTINGS_SECTIONS.map((section) => {
          const current = section.id === active;
          return (
            <li key={section.id}>
              <Link
                href={settingsHref(section.id)}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "block rounded-[10px] px-3 py-2 text-[15px] transition-colors duration-200 ease-standard outline-none",
                  current
                    ? "bg-card font-semibold text-foreground"
                    : "font-medium text-foreground/72 hover:bg-black/5 hover:text-foreground",
                )}
              >
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Mobile: the index you drill into. Each row is a 44px target with the section's one-line description. */
export function SettingsIndex() {
  return (
    <Card className="gap-0 py-2 lg:hidden">
      {SETTINGS_SECTIONS.map((section) => (
        <Link
          key={section.id}
          href={settingsHref(section.id)}
          className="mx-6 flex min-h-11 items-center justify-between gap-4 border-b border-border py-3 last:border-0 outline-none"
        >
          <span className="min-w-0">
            <span className="block text-[15px] font-medium text-foreground">{section.label}</span>
            <span className="block text-footnote text-muted-foreground">{section.blurb}</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-tertiary" aria-hidden="true" />
        </Link>
      ))}
    </Card>
  );
}
