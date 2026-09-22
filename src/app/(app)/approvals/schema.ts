import { z } from "zod";

/** Shared between the actions (validation) and the decision dialog (input limits). Pure — safe for client files. */
export const DECISION_NOTE_MAX = 500;

export const DecisionInputSchema = z.object({
  approvalId: z.string().min(1),
  decision: z.enum(["approve", "reject"]),
  note: z
    .string()
    .trim()
    .max(DECISION_NOTE_MAX, `Keep the note under ${DECISION_NOTE_MAX} characters`)
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export type Decision = z.infer<typeof DecisionInputSchema>["decision"];
