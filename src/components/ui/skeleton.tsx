import { cn } from "@/lib/utils"

/** A calm opacity pulse — never a shimmer sweep. Match the radius to what is loading (18px cards, 8px text). */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "rounded-sm bg-[#ececf0] motion-safe:animate-[skeleton-pulse_1.6s_ease-in-out_infinite]",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
