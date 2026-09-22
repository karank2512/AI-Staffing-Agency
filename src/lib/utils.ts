import { createCn } from "cn/config";

/**
 * The type-scale utilities from `globals.css`. They must be registered as font sizes: `cn()` otherwise reads
 * `text-<anything-it-doesn't-know>` as a text *colour*, so `cn("text-footnote", "text-muted-foreground")` would
 * silently drop the size and the element would render at the inherited size.
 */
const TYPE_SCALE = [
  "display-xl",
  "display",
  "headline",
  "title-1",
  "title-2",
  "title-3",
  "body-lg",
  "body",
  "body-app",
  "callout",
  "footnote",
  "caption",
  "metric-xl",
  "metric",
] as const;

/**
 * `clsx` + tailwind-merge, taught about our own utilities. Import `cn` from here — never from the bare `cn`
 * package — so every component merges classes against the same configuration.
 */
export const cn = createCn({
  extend: { classGroups: { "font-size": [{ text: [...TYPE_SCALE] }] } },
});
