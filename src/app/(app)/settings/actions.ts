"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/action-result";
import { requireSession } from "@/server/auth";
import { deleteCredential, setCredential } from "@/server/secrets";
import { limitCredentialsAction, ToolNameSchema } from "../_lib/action-guards";
import { SetCredentialInputSchema } from "./schema";

/**
 * Store (or replace) a tool credential in the workspace vault. The value travels to the server exactly once and
 * is never returned: the page re-renders with the vault's metadata (last4, set date) instead.
 */
export async function setCredentialAction(input: { name: string; value: string; label?: string }): Promise<ActionResult> {
  return runAction(async () => {
    const s = await requireSession();
    await limitCredentialsAction(s);
    const parsed = SetCredentialInputSchema.parse(input);
    await setCredential(s, parsed);
    revalidatePath("/settings");
  });
}

/** Remove a tool credential; the tools it powered fall back to the server's .env, then to Simulated. */
export async function deleteCredentialAction(name: string): Promise<ActionResult> {
  return runAction(async () => {
    const s = await requireSession();
    await limitCredentialsAction(s);
    await deleteCredential(s, ToolNameSchema.parse(name));
    revalidatePath("/settings");
  });
}
