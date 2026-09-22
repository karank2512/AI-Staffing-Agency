"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface CopyButtonProps {
  /** Text placed on the clipboard. */
  value: string;
  /** Optional visible label ("Copy CSV"). Without it the button is a circular icon button. */
  label?: string;
  className?: string;
}

/** Copy-to-clipboard with a short "Copied" confirmation. Failures (permissions, insecure origin) toast. */
export function CopyButton({ value, label, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy(event: MouseEvent<HTMLButtonElement>) {
    // JsonView places this button inside a <details> <summary>: without this, the click also toggles the panel.
    event.preventDefault();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("Couldn't copy to the clipboard");
    }
  }

  const Icon = copied ? Check : Copy;
  const button = (
    <Button
      type="button"
      variant="ghost"
      size={label ? "sm" : "icon-sm"}
      onClick={copy}
      aria-label={label ? undefined : copied ? "Copied" : "Copy to clipboard"}
      className={cn("text-muted-foreground hover:text-foreground", className)}
    >
      <Icon className={cn("size-3.5", copied && "text-success")} aria-hidden="true" />
      {label ? <span>{copied ? "Copied" : label}</span> : null}
    </Button>
  );

  if (label) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="top">{copied ? "Copied" : "Copy"}</TooltipContent>
    </Tooltip>
  );
}
