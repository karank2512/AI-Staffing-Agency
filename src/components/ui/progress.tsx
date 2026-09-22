"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Progress as ProgressPrimitive } from "radix-ui"

/**
 * A 4px rail. Pass a number for determinate progress; omit `value` (or pass `null`) for the indeterminate state,
 * which slides a 30% bar — and holds still under `prefers-reduced-motion`.
 */
function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const indeterminate = value === null || value === undefined

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn(
        "relative flex h-1 w-full items-center overflow-x-hidden rounded-full bg-secondary",
        className
      )}
      {...props}
    >
      {indeterminate ? (
        <ProgressPrimitive.Indicator
          data-slot="progress-indicator"
          data-indeterminate=""
          className="h-full w-[30%] rounded-full bg-primary motion-safe:animate-[progress-indeterminate_1.2s_ease-in-out_infinite]"
        />
      ) : (
        <ProgressPrimitive.Indicator
          data-slot="progress-indicator"
          className="size-full flex-1 rounded-full bg-primary transition-transform duration-[400ms] ease-out"
          style={{ transform: `translateX(-${100 - value}%)` }}
        />
      )}
    </ProgressPrimitive.Root>
  )
}

export { Progress }
