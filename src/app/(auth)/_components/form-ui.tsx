import type { ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { LogoGlyph } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Soft-tinted callout above a form. No side stripe, no icon, no colour beyond the text and the fill. */
export function FormAlert({
  tone = "danger",
  id,
  children,
}: {
  tone?: "danger" | "info";
  id?: string;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "rounded-lg px-4 py-3 text-[14px] leading-5",
        tone === "danger" ? "bg-danger-soft text-danger" : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </div>
  );
}

/** The single blue pill each auth page gets: full width, 44px, with its own pending sentence. */
export function SubmitButton({
  pending,
  label,
  pendingLabel,
  disabled = false,
}: {
  pending: boolean;
  label: string;
  pendingLabel: string;
  disabled?: boolean;
}) {
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending || disabled} aria-busy={pending}>
      {pending ? (
        <>
          <LoaderCircle className="animate-spin" aria-hidden />
          {pendingLabel}
        </>
      ) : (
        label
      )}
    </Button>
  );
}

/** Glyph, title, one line of context — the only hierarchy an auth page needs. */
export function AuthHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="mb-9">
      <LogoGlyph className="size-10" />
      <h1 className="text-headline mt-6">{title}</h1>
      <p className="mt-3 text-[17px] leading-[25px] text-muted-foreground">{description}</p>
    </header>
  );
}
