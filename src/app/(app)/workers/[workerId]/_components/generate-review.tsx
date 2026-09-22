"use client";

import { useTransition, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { generateReviewAction } from "../actions";

const RECOMMENDATION_COPY = {
  KEEP: (name: string) => `${name} is doing well — keep going.`,
  IMPROVE: (name: string) => `${name} could do better — see what to change.`,
  REPLACE: (name: string) => `The review recommends replacing ${name}.`,
} as const;

/**
 * "Performance review" — shared by the header's More menu and the Performance tab so both give the same
 * feedback: a loading toast while the review is written, then the verdict and a jump to the Performance tab.
 */
export function useGenerateReview(workerId: string, workerName: string) {
  const router = useRouter();
  const [reviewing, startReview] = useTransition();

  function generate() {
    startReview(async () => {
      const toastId = toast.loading(`Writing ${workerName}'s performance review…`);
      const r = await generateReviewAction(workerId);
      if (!r.ok) {
        toast.error(r.error, { id: toastId });
        return;
      }
      toast.success(`Performance review ready — ${Math.round(r.data.overallScore)}/100`, {
        id: toastId,
        description: RECOMMENDATION_COPY[r.data.recommendation](workerName),
      });
      router.push(`/workers/${workerId}?tab=performance`);
      router.refresh();
    });
  }

  return { reviewing, generate };
}

export interface GenerateReviewButtonProps extends Pick<ComponentProps<typeof Button>, "variant" | "size" | "className"> {
  workerId: string;
  workerName: string;
  disabled?: boolean;
  label?: string;
}

export function GenerateReviewButton({
  workerId,
  workerName,
  disabled = false,
  label = "Write a review",
  variant = "secondary",
  size,
  className,
}: GenerateReviewButtonProps) {
  const { reviewing, generate } = useGenerateReview(workerId, workerName);
  return (
    <Button type="button" variant={variant} size={size} className={className} disabled={disabled || reviewing} onClick={generate}>
      {reviewing ? "Writing…" : label}
    </Button>
  );
}
