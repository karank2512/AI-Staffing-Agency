import * as React from "react"
import { cn } from "@/lib/utils"

/** Matches Input, with a 112px floor so a paragraph of brief has room before it starts growing. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-28 w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-base transition-[border-color,box-shadow] duration-200 ease-standard outline-none placeholder:text-tertiary focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:bg-muted disabled:text-tertiary aria-invalid:border-danger aria-invalid:ring-4 aria-invalid:ring-danger/15 sm:text-[15px]",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
