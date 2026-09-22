import type { SimPage } from "@/server/simulation/types";
import { isoDaysAgo, longDate } from "./dates";
import { hashSeed, seededInt, seededShuffle } from "./rng";
import { sentenceCase } from "./text";

/**
 * Fallback content for URLs the simulation has no fixture for (and for "anything else" search queries).
 * The page is generic by design — no invented facts or numbers about real things — but reads like a real
 * explainer on the topic found in the URL, so downstream steps have sensible text to work with.
 */

const PARAGRAPHS: ReadonlyArray<(topic: string) => string> = [
  (t) => `Most teams approach ${t} the same way at first: a spreadsheet, a few bookmarked sources and a recurring calendar reminder. That works until the volume of information outgrows the time anyone has to read it.`,
  (t) => `Practitioners we spoke to described three recurring challenges with ${t}: keeping sources current, separating signal from noise, and turning findings into something a decision-maker will actually read.`,
  (t) => `A useful rule of thumb for ${t} is to decide up front what a good result looks like. Write down the fields you need, how fresh the information must be, and who will act on it.`,
  (t) => `When it comes to ${t}, consistency beats intensity. A short, structured update every week is more valuable than an exhaustive report once a quarter that nobody finishes.`,
  (t) => `Tooling for ${t} has improved quickly. Automation now handles most of the collection and formatting work, which leaves people free to check the judgment calls.`,
  (t) => `The most common mistake with ${t} is skipping verification. Every claim should trace back to a source, and anything that cannot be confirmed should be labeled as unverified rather than quietly dropped.`,
  (t) => `Teams that get lasting value from ${t} close the loop: they review what was useful, prune what was not, and adjust the brief so the next round is sharper than the last.`,
];

/** "https://insights.example/articles/remote-team-onboarding-2" → "remote team onboarding". */
export function topicFromUrl(url: string): string {
  let path = url;
  let host = "";
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`);
    path = u.pathname;
    host = u.hostname.replace(/^www\./, "");
  } catch {
    // keep the raw string as the path
  }
  const last = path.split("/").filter(Boolean).pop() ?? "";
  const words = decodeSafe(last)
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/-\d+$/, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim();
  if (words.length >= 3) return words.toLowerCase();
  const hostWords = host.split(".")[0]?.replace(/[^a-zA-Z0-9]+/g, " ").trim();
  return hostWords && hostWords.length >= 3 ? hostWords.toLowerCase() : "this topic";
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function genericPage(url: string, now: Date): SimPage {
  const topic = topicFromUrl(url);
  const seed = hashSeed(url);
  const published = isoDaysAgo(seededInt(seed, 2, 40), now);
  const body = seededShuffle(PARAGRAPHS, seed)
    .slice(0, 4)
    .map((p) => p(topic));
  return {
    url,
    title: `${sentenceCase(topic)}: a practical overview`,
    text: [`${sentenceCase(topic)} — published ${longDate(published)}.`, ...body].join("\n\n"),
  };
}
