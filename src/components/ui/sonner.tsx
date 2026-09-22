"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

/**
 * White glass toasts with a small tone-coloured icon — never a coloured toast background (that reads as generic
 * SaaS). The theme is pinned by the caller; there is no dark mode in this product.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4 text-success" />,
        info: <InfoIcon className="size-4 text-info" />,
        warning: <TriangleAlertIcon className="size-4 text-warning" />,
        error: <OctagonXIcon className="size-4 text-danger" />,
        loading: <Loader2Icon className="size-4 animate-spin text-muted-foreground" />,
      }}
      style={
        {
          "--normal-bg": "var(--material-thick)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "transparent",
          "--border-radius": "14px",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            "cn-toast backdrop-blur-[20px] backdrop-saturate-[180%] shadow-popover gap-3",
          title: "text-[15px] font-semibold tracking-[-0.01em]",
          description: "text-[13px] text-muted-foreground",
          actionButton: "rounded-full bg-primary px-3 text-[13px] font-medium text-primary-foreground",
          cancelButton: "rounded-full bg-secondary px-3 text-[13px] font-medium text-secondary-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
