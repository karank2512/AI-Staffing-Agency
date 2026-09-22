/** What every deterministic operation returns: the context value plus a compact trace for the RunStep. */
export interface OpResult<T = unknown> {
  value: T;
  /** Small, JSON-serializable summary stored as RunStep.output (never the full records). */
  summary: Record<string, unknown>;
  /** One line for RunStep.detail, e.g. "14 → 12 records (2 dropped)". */
  detail: string;
}
