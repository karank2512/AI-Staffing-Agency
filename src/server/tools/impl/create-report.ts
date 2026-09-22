import { defineTool, quote } from "../define";

/** A heading typed as "## Summary" must not become "## ## Summary". */
function cleanHeading(text: string): string {
  return text.replace(/^#+\s*/, "").replace(/\s+/g, " ").trim();
}

export function assembleReport(title: string, sections: Array<{ heading: string; body: string }>): string {
  const parts = [`# ${cleanHeading(title)}`];
  for (const section of sections) {
    const heading = cleanHeading(section.heading);
    const body = section.body.replace(/\r\n/g, "\n").trim();
    parts.push(`## ${heading}${body ? `\n\n${body}` : ""}`);
  }
  return `${parts.join("\n\n")}\n`;
}

export const createReportTool = defineTool("create_report", {
  displayName: "Report builder",
  description:
    "Assemble a markdown report from a title and ordered sections (heading + markdown body). Returns the full markdown document.",
  humanDescription: "Assembles findings into a clean, sectioned markdown report.",
  category: "output",
  sideEffect: "none",
  defaultRequiresApproval: false,
  costPerCallUsd: 0,
  humanize: (input) => `Compiled the report ${quote(input.title)}`,
  describeForApproval: (input) => ({ title: `Compile the report ${quote(input.title)}` }),
  async execute(input) {
    return { output: { markdown: assembleReport(input.title, input.sections) }, simulated: false };
  },
});
