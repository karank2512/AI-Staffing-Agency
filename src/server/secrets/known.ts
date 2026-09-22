export interface KnownCredential {
  /** Secret name — also the env var used as the process-wide fallback. */
  name: string;
  label: string;
  /** Tool names that switch from Simulated to Live when this secret resolves. */
  usedBy: string[];
  docsUrl: string;
}

/**
 * The only secrets the vault accepts. Model-provider keys are deliberately NOT here:
 * in Phase 1 they are env-only (process-wide); the vault feeds tools only.
 */
export const KNOWN_CREDENTIALS: ReadonlyArray<KnownCredential> = [
  {
    name: "TAVILY_API_KEY",
    label: "Tavily API key",
    usedBy: ["web_search"],
    docsUrl: "https://docs.tavily.com",
  },
];

export function isKnownCredential(name: string): boolean {
  return KNOWN_CREDENTIALS.some((c) => c.name === name);
}
