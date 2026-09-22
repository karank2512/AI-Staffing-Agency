import type { AgentComponent } from "@/server/domain/blueprint";
import { llm } from "@/server/models";
import type { ChatMessage } from "@/server/models/types";
import { agentTurnHints, simulation } from "@/server/simulation";
import { tools } from "@/server/tools";
import { RunFailure, toRunFailure } from "./failure";
import { parseJsonAnswer } from "./json";
import { buildInitialMessage, buildSystemPrompt, repairPrompt } from "./messages";
import type { RunSlice } from "./slice";
import { resolvePending, startToolBatch } from "./tool-calls";
import type { AgentCheckpoint } from "./types";

/**
 * The agent component loop. Each turn: a MODEL_CALL step is created BEFORE the model is called (so the
 * ModelCall row can point at it), tool calls are executed as a batch, and the conversation is checkpointed after
 * every batch. An approval pause returns `paused`; the next slice resumes from `checkpoint.agent`.
 */

export type AgentResult = { status: "done"; output: unknown } | { status: "paused"; approvalIds: string[] };

function freshAgent(component: AgentComponent, context: Record<string, unknown>): AgentCheckpoint {
  const initial: ChatMessage = { role: "user", content: buildInitialMessage(component, context) };
  return { componentId: component.id, messages: [initial], turn: 0, pendingToolCalls: [] };
}

export async function runAgentComponent(slice: RunSlice, component: AgentComponent): Promise<AgentResult> {
  const { cp, blueprint, spec } = slice;
  const agent = cp.agent?.componentId === component.id ? cp.agent : freshAgent(component, cp.context);
  cp.agent = agent;

  if (agent.pendingToolCalls.length > 0) {
    const batch = await resolvePending(slice, component, agent, { resumed: true });
    if (batch.paused) return { status: "paused", approvalIds: batch.approvalIds };
    await slice.saveCheckpoint();
  }

  const system = buildSystemPrompt(blueprint.persona, component);
  const toolSpecs = tools.specsFor(component.tools);
  const instructions = slice.run.input.instructions;
  const jobBrief = typeof cp.context.job_brief === "string" ? cp.context.job_brief : "";
  // The mock brain counts duplicates the way this blueprint's dedupe step defines them.
  const hints = agentTurnHints(blueprint);
  let repairPending = false;

  for (;;) {
    if (agent.turn >= component.maxTurns && !repairPending) {
      throw new RunFailure("MODEL_ERROR", `${component.name} could not finish within ${component.maxTurns} turns`, true);
    }
    await slice.enforceLimits();

    const step = await slice.steps.begin({
      kind: "MODEL_CALL",
      componentId: component.id,
      title: `${slice.workerName} is thinking (${component.name}, turn ${agent.turn + 1})`,
      input: { turn: agent.turn + 1, tier: component.modelTier, tools: component.tools, messages: agent.messages.length },
    });

    let result;
    try {
      result = await llm.generateText(
        {
          tier: component.modelTier,
          system,
          messages: agent.messages,
          tools: toolSpecs,
          mock: (input) => simulation.agentTurn({ component, jobFamily: blueprint.jobFamily, spec, jobBrief, instructions, ...hints, ...input }),
        },
        {
          organizationId: slice.run.organizationId,
          purpose: "agent.turn",
          workerId: slice.run.workerId,
          jobId: slice.run.jobId,
          runId: slice.run.id,
          runStepId: step.id,
        },
      );
    } catch (e) {
      const failure = toRunFailure(e);
      await slice.steps.finish(step, { status: "FAILED", error: failure.message });
      throw failure;
    }

    agent.turn += 1;
    repairPending = false;
    cp.counters.modelCalls += 1;
    cp.counters.costUsd += result.costUsd;
    await slice.steps.finish(step, {
      status: "SUCCEEDED",
      detail: `${result.model} · ${result.usage.inputTokens + result.usage.outputTokens} tokens${result.simulated ? " · Simulated" : ""}`,
      output: {
        text: result.text,
        toolCalls: result.toolCalls.map((c) => ({ id: c.id, name: c.name, input: c.input })),
        finishReason: result.finishReason,
        usage: result.usage,
        costUsd: result.costUsd,
      },
    });

    agent.messages.push({ role: "assistant", content: result.text, ...(result.toolCalls.length > 0 ? { toolCalls: result.toolCalls } : {}) });

    if (result.toolCalls.length > 0) {
      const batch = await startToolBatch(slice, component, agent, result.toolCalls);
      if (batch.paused) return { status: "paused", approvalIds: batch.approvalIds };
      await slice.saveCheckpoint();
      continue;
    }

    if (component.outputFormat !== "json") return { status: "done", output: result.text };

    const parsed = parseJsonAnswer(result.text);
    if (parsed.ok) return { status: "done", output: parsed.value };
    if (agent.messages.some((m) => m.role === "user" && m.content.startsWith("Your previous answer could not be used"))) {
      throw new RunFailure("MODEL_ERROR", `${component.name} did not return valid JSON: ${parsed.error}`, true);
    }
    // One repair turn, allowed even when maxTurns is spent: it is cheaper than failing the whole run.
    agent.messages.push({ role: "user", content: repairPrompt(component, parsed.error) });
    repairPending = true;
    await slice.saveCheckpoint();
  }
}
