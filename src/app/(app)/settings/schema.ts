import { z } from "zod";

/** Shared between the credential actions (validation) and the dialog (input limits). Pure — safe for client files. */
export const CREDENTIAL_VALUE_MAX = 4096;
export const CREDENTIAL_LABEL_MAX = 120;

export const SetCredentialInputSchema = z.object({
  name: z.string().trim().min(1, "Pick which key to set"),
  value: z
    .string()
    .trim()
    .min(1, "Paste the key first")
    .max(CREDENTIAL_VALUE_MAX, `Keys are at most ${CREDENTIAL_VALUE_MAX} characters`),
  label: z
    .string()
    .trim()
    .max(CREDENTIAL_LABEL_MAX, `Keep the label under ${CREDENTIAL_LABEL_MAX} characters`)
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export type SetCredentialInput = z.infer<typeof SetCredentialInputSchema>;
