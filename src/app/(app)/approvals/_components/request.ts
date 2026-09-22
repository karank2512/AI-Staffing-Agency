/**
 * Pure helpers for reading a pending request: the sentence at the top of a card, and a human summary of the
 * exact tool input being approved. No server imports — the decision dialog is a client component.
 */

export interface PayloadField {
  label: string;
  value: string;
  /** Recipient lists and the like: worth showing in full, even in the compact form. */
  emphasis?: boolean;
}

export interface PayloadSummary {
  fields: PayloadField[];
  /** The long free-text part of the request (an email body), as plain text. */
  body: string | null;
  /** The payload holds structure the field list can't express — offer the raw JSON as well. */
  complex: boolean;
}

/** "Send “Weekly digest” to 3 recipients" → "Maya wants to send “Weekly digest” to 3 recipients". */
export function requestSentence(workerName: string, title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return `${workerName} is waiting on you`;
  const [first = "", second = ""] = [trimmed.charAt(0), trimmed.charAt(1)];
  // Leave acronyms alone: "URL" must not become "uRL".
  const opener = second && second === second.toUpperCase() && second !== second.toLowerCase() ? first : first.toLowerCase();
  return `${workerName} wants to ${opener}${trimmed.slice(1)}`;
}

const LABELS: Record<string, string> = {
  recipients: "To",
  subject: "Subject",
  channel: "Send by",
  query: "Search for",
  url: "Page",
  dataset: "Dataset",
  expression: "Expression",
  title: "Title",
  fields: "Fields",
  columns: "Columns",
  maxResults: "Results",
  maxRecords: "Records",
  limit: "Limit",
};

/** Long free text is shown as a body excerpt rather than a one-line field value. */
const BODY_KEYS = ["body", "message", "content", "markdown", "text"];

const PRIORITY = ["channel", "recipients", "subject", "title", "query", "url", "dataset", "expression"];

const MAX_LISTED = 4;
const MAX_VALUE_CHARS = 180;

function labelFor(key: string): string {
  if (LABELS[key]) return LABELS[key];
  const spaced = key.replace(/[_-]+/g, " ").replace(/([a-z\d])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** Markdown markers read as noise in a preview; strip them without pulling in a parser. */
export function toPlainText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}[#>*-]+\s?/gm, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function listValue(values: string[]): string {
  const shown = values.slice(0, MAX_LISTED).join(", ");
  return values.length > MAX_LISTED ? `${shown} and ${values.length - MAX_LISTED} more` : shown;
}

/**
 * Turn a tool input into "To / Subject / …" rows plus a body excerpt, so a person can see exactly what will
 * happen without reading JSON. Anything it can't express sets `complex`, and the caller falls back to the raw
 * payload — a preview must never hide part of what is being approved.
 */
export function summarizePayload(payload: unknown): PayloadSummary {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    const text = typeof payload === "string" ? payload : payload === undefined ? "" : JSON.stringify(payload);
    return { fields: [], body: text ? toPlainText(text) : null, complex: Array.isArray(payload) };
  }

  const fields: PayloadField[] = [];
  let body: string | null = null;
  let complex = false;

  for (const [key, raw] of Object.entries(payload as Record<string, unknown>)) {
    if (raw === null || raw === undefined) continue;

    if (typeof raw === "string") {
      const plain = toPlainText(raw);
      if (!plain) continue;
      if (BODY_KEYS.includes(key) && (body === null || plain.length > body.length) && plain.length > 90) {
        body = plain;
        continue;
      }
      fields.push({ label: labelFor(key), value: clip(plain, MAX_VALUE_CHARS) });
      continue;
    }

    if (typeof raw === "number" || typeof raw === "boolean") {
      fields.push({ label: labelFor(key), value: String(raw) });
      continue;
    }

    if (Array.isArray(raw)) {
      const strings = raw.filter((v): v is string => typeof v === "string");
      if (strings.length === raw.length && raw.length > 0) {
        fields.push({ label: labelFor(key), value: listValue(strings), emphasis: key === "recipients" });
        continue;
      }
      fields.push({ label: labelFor(key), value: `${raw.length} ${raw.length === 1 ? "entry" : "entries"}` });
      complex = true;
      continue;
    }

    complex = true;
  }

  fields.sort((a, b) => {
    const rank = (f: PayloadField) => {
      const index = PRIORITY.findIndex((key) => labelFor(key) === f.label);
      return index === -1 ? PRIORITY.length : index;
    };
    return rank(a) - rank(b);
  });

  return { fields, body, complex };
}
