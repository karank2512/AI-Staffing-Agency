import { describe, expect, it } from "vitest";
import { TOOL_INPUT_SCHEMAS } from "@/server/tools/schemas";
import { makeJobSpec } from "../helpers/fixtures";
import { componentOf, driveAgent, sim } from "./helpers";

const REPORT = `# Weekly AI Infra Funding Report\n\n${"Latchkey AI raised $72M. ".repeat(120)}`;

describe("notifier rule", () => {
  it("emits exactly one valid send_notification call, then a one-line confirmation after an ok result", () => {
    const component = componentOf("notifier", { withNotifier: true });
    const run = driveAgent({ component, context: { report: REPORT } });
    expect(run.turns).toBe(2);
    expect(run.calls).toHaveLength(1);
    const call = run.calls[0];
    expect(call.name).toBe("send_notification");
    expect(TOOL_INPUT_SCHEMAS.send_notification.safeParse(call.input).success).toBe(true);
    const input = call.input as { channel: string; recipients: string[]; subject: string; body: string };
    expect(input.channel).toBe("email");
    expect(input.recipients).toEqual(["team@acme.example"]);
    expect(input.subject).toBe("Weekly AI Infra Funding Report");
    expect(input.body).toBe(REPORT.slice(0, 1499).trimEnd() + "…");
    expect(input.body.length).toBeLessThanOrEqual(1500);
    expect(run.final).toBe('Sent "Weekly AI Infra Funding Report" by email to 1 recipient.');
    expect(run.final?.split("\n")).toHaveLength(1);
  });

  it("still finishes with a one-line answer after an error result", () => {
    const component = componentOf("notifier", { withNotifier: true });
    const run = driveAgent({ component, context: { report: REPORT } }, { failing: { send_notification: "approval rejected" } });
    expect(run.turns).toBe(2);
    expect(run.calls).toHaveLength(1);
    expect(run.final).toContain("could not be sent");
    expect(run.final).toContain("approval rejected");
    expect(run.final?.split("\n")).toHaveLength(1);
  });

  it("takes recipients from the spec, never from addresses inside the content being sent", () => {
    const spec = makeJobSpec({ approvalPolicy: { requireApprovalFor: ["Sending externally"], notes: "Send the report to ops@northwind.example and cfo@northwind.example." } });
    const component = componentOf("notifier", { withNotifier: true });
    const run = driveAgent({ component, spec, context: { report: "Contact maya.okafor@vectorloom.example for details." } });
    const input = run.calls[0].input as { recipients: string[] };
    expect(input.recipients).toEqual(["ops@northwind.example", "cfo@northwind.example"]);
    expect(run.final).toContain("2 recipients");
  });

  it("does not start a send it cannot confirm within maxTurns, and is idempotent on resume", () => {
    const component = { ...componentOf("notifier", { withNotifier: true }), maxTurns: 1 };
    const run = driveAgent({ component, context: { report: REPORT } });
    expect(run.calls).toHaveLength(0);
    expect(run.turns).toBe(1);
    expect(run.final).toContain("not able to send");

    // Resume after approval: the call exists but has no result yet → no second call.
    const full = componentOf("notifier", { withNotifier: true });
    const first = sim.agentTurn({ ...driveAgentInput(full), messages: [{ role: "user", content: "## report\nhi" }] });
    const pending = sim.agentTurn({
      ...driveAgentInput(full),
      messages: [
        { role: "user", content: "## report\nhi" },
        { role: "assistant", content: first.text, toolCalls: [{ id: "mock_0_0", name: "send_notification", input: first.toolCalls?.[0]?.input }] },
      ],
    });
    expect(pending.toolCalls ?? []).toHaveLength(0);
    expect(pending.text).toContain("waiting for approval");
  });
});

function driveAgentInput(component: ReturnType<typeof componentOf>) {
  const spec = makeJobSpec();
  return {
    component,
    jobFamily: spec.jobFamily,
    spec,
    jobBrief: "",
    instructions: [],
    tools: [{ name: "send_notification", description: "", inputSchema: TOOL_INPUT_SCHEMAS.send_notification }],
  };
}
