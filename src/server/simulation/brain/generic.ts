import type { MockTextResponse } from "@/server/models/types";
import type { MockAgentTurnInput } from "@/server/simulation/types";
import { longDate } from "../dates";
import { clip, sentenceCase } from "../text";
import { searchResults } from "./candidates";
import { Conversation, toolTurn } from "./conversation";
import { genericRecords } from "./generic-records";
import { buildJobContext } from "./job";

/**
 * Fallback for shapes the specialised brains do not cover: a markdown agent that was given no records (for
 * example a content or "general" job), possibly with research tools. It does at most one web search, then
 * writes a structured note that follows the spec's section headings and cites what it found.
 */

const SEARCH_RESULTS = 6;

function sources(input: MockAgentTurnInput, convo: Conversation): string[] {
  return searchResults(convo).map((r) => `- [${r.title}](${r.url}) — ${r.source}, ${longDate(r.publishedAt)}`);
}

function sectionBody(input: MockAgentTurnInput, index: number, convo: Conversation): string[] {
  const { spec } = input;
  const found = sources(input, convo);
  const criteria = spec.successCriteria.map((c) => `- ${c.description}${c.target ? ` (target: ${c.target})` : ""}`);
  const pools: string[][] = [
    [spec.objective, "", ...spec.responsibilities.map((r) => `- ${sentenceCase(r)}`)],
    found.length > 0 ? ["Sources reviewed this run:", "", ...found] : ["No external sources were available this run; this section is based on the brief.", "", ...criteria],
    ["What this run was measured against:", "", ...criteria],
    spec.constraints.length > 0 ? ["Constraints observed:", "", ...spec.constraints.map((c) => `- ${c}`)] : ["Assumptions:", "", ...spec.assumptions.map((a) => `- ${a}`)],
  ];
  return pools[index % pools.length];
}

export function genericTurn(input: MockAgentTurnInput, now: Date): MockTextResponse {
  const convo = new Conversation(input.messages, input.tools, input.component.maxTurns);
  const ctx = buildJobContext(input);
  if (convo.remainingTurns >= 2 && convo.canTry("web_search")) {
    const query = ctx.queries[0] ?? input.spec.title;
    const turn = toolTurn(convo, `Looking up "${query}".`, [{ name: "web_search", input: { query, maxResults: SEARCH_RESULTS } }]);
    if (turn) return turn;
  }
  if (input.component.outputFormat === "json") {
    return { text: JSON.stringify(genericRecords(convo, ctx, now).slice(0, ctx.count), null, 2) };
  }

  const { spec } = input;
  const headings = spec.deliverable.sections.length > 0 ? spec.deliverable.sections : ["Summary", "Findings", "Next steps"];
  const lines: string[] = [`${spec.deliverable.title} — ${clip(spec.summary, 200)}`, ""];
  headings.forEach((heading, i) => {
    lines.push(`## ${heading}`, "", ...sectionBody(input, i, convo), "");
  });
  const found = sources(input, convo);
  if (found.length > 0 && headings.length < 2) lines.push("## Sources", "", ...found, "");
  return { text: lines.join("\n").trimEnd() };
}
