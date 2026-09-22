import type { AvatarColor } from "@/server/domain";
import { initialsOf } from "@/lib/initials";
import { cn } from "@/lib/utils";

/**
 * FULL static class strings — Tailwind only generates classes it can see verbatim in source, so never build
 * these with template strings. Typed by `AvatarColor` (type-only import) so adding a token to
 * `AVATAR_COLORS` in the domain fails the build until it has classes here.
 */
const AVATAR_COLOR_CLASSES: Record<AvatarColor, string> = {
  violet: "bg-violet-100 text-violet-700 ring-violet-200",
  sky: "bg-sky-100 text-sky-700 ring-sky-200",
  emerald: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-100 text-amber-800 ring-amber-200",
  rose: "bg-rose-100 text-rose-700 ring-rose-200",
  indigo: "bg-indigo-100 text-indigo-700 ring-indigo-200",
  teal: "bg-teal-100 text-teal-700 ring-teal-200",
  orange: "bg-orange-100 text-orange-700 ring-orange-200",
};

const SIZE_CLASSES = {
  sm: "size-6 text-[10px]",
  md: "size-9 text-xs",
  lg: "size-14 text-lg",
} as const;

const FALLBACK_COLOR: AvatarColor = "violet";

function isAvatarColor(color: string): color is AvatarColor {
  return Object.prototype.hasOwnProperty.call(AVATAR_COLOR_CLASSES, color);
}

export interface WorkerAvatarProps {
  /** Worker persona name; initials are derived from it. */
  name: string;
  /** `Worker.avatarColor` — one of the domain `AVATAR_COLORS` tokens. Unknown values fall back to violet. */
  color: string;
  /** sm = 24px (table rows, feeds) · md = 36px (cards, default) · lg = 56px (profile header). */
  size?: "sm" | "md" | "lg";
  className?: string;
}

/** A worker's face everywhere in the product: initials on a soft tinted circle. */
export function WorkerAvatar({ name, color, size = "md", className }: WorkerAvatarProps) {
  const tint = AVATAR_COLOR_CLASSES[isAvatarColor(color) ? color : FALLBACK_COLOR];
  return (
    <span
      data-slot="worker-avatar"
      role="img"
      aria-label={name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-tight ring-1 select-none ring-inset",
        SIZE_CLASSES[size],
        tint,
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
