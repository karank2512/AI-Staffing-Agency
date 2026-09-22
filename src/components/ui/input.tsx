import * as React from "react"
import { cn } from "@/lib/utils"

/** 44px tall, 12px radius, white fill. 16px text under 640px so iOS never zooms on focus; 15px above. */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3.5 py-2 text-base transition-[border-color,box-shadow] duration-200 ease-standard outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-tertiary focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/15 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:text-tertiary aria-invalid:border-danger aria-invalid:ring-4 aria-invalid:ring-danger/15 sm:text-[15px]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
