import { isValidElement, type ReactElement } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * Shared `icon` prop type: pass the lucide component (`icon={Users}`) and the host component sizes it, or pass
 * an element (`icon={<Users className="size-5 text-rose-500" />}`) to take control.
 *
 * Passing the component reference only works from a server component into another server-compatible component
 * (StatCard, EmptyState) or client → client; functions cannot cross the server → client boundary.
 */
export type IconProp = LucideIcon | ReactElement;

export function IconSlot({ icon, className }: { icon: IconProp; className?: string }) {
  if (isValidElement(icon)) return icon;
  const Icon = icon as LucideIcon;
  return <Icon className={className} aria-hidden="true" />;
}
