import { getAiCapabilitySettings, isAiScopeGloballyEnabled } from "./capabilities.js";
import { listActiveAiScopes } from "./agentState.js";
import { getAiProvider, type AiProviderMessage } from "./providers/index.js";
import { agentMailRegistry, AgentToolRegistry } from "./tools/registry.js";
import type { AgentExecutionContext, AgentToolDefinition } from "./tools/types.js";
import { agentWorkerProfiles } from "./workers.js";
import type { AgentWorkerId } from "./skills.js";

const workerPrompt = (worker: AgentWorkerId) => {
  const profile = agentWorkerProfiles[worker];
  return [
    `You are the ${profile.title} inside GSW Mail.`,
    profile.description,
    "You are a bounded subagent working for the main GSW coordinator.",
    "Investigate the assigned task using only the tools available to you.",
    "Do not send email, launch campaigns, mutate user data, or claim actions you did not perform.",
    "Return concise findings, source/resource identifiers when useful, unresolved ambiguity, and a recommended next action for the coordinator.",
    "If the available tools are insufficient, say exactly what capability is missing.",
  ].join(" ");
};

const allowedForWorker = (tool: AgentToolDefinition, worker: AgentWorkerId) => {
  const profile = agentWorkerProfiles[worker];
  if (tool.risk !== "read") return false;
  if (tool.name === "capabilities.search") return false;
  return profile.toolPrefixes.some((prefix) => tool.name === prefix || tool.name.startsWith(prefix));
};

export async function runReadOnlyWorker(input: {
  worker: AgentWorkerId;
  instruction: string;
  context: AgentExecutionContext;
  maxTurns?: number;
}) {
  const capabilitySettings = await getAiCapabilitySettings(input.context.userId);
  const active = await listActiveAiScopes(input.context.userId, input.context.accountId);
  const granted = new Set(active.map((item) => item.scope));

  const definitions = agentMailRegistry.definitions().filter((tool) =>
    allowedForWorker(tool, input.worker)
    && tool.requiredScopes.every((scope) => isAiScopeGloballyEnabled(capabilitySettings, scope))
    && tool.requiredScopes.every((scope) => granted.has(scope)),
  );
  const registry = new AgentToolRegistry(definitions);
  const tools = registry.providerDefinitions();
  const provider = getAiProvider(capabilitySettings.modelProvider);
  const messages: AiProviderMessage[] = [
    { role: "user", content: workerPrompt(input.worker) },
    { role: "user", content: input.instruction.slice(0, 20_000) },
  ];
  const activity: Array<{ tool: string; ok: boolean }> = [];
  const maxTurns = Math.min(Math.max(input.maxTurns ?? 4, 1), 6);
  let model = "";

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const result = await provider.run({ messages, ...(tools.length ? { tools } : {}) });
    model = result.model;
    if (result.toolCalls.length === 0) {
      return {
        worker: input.worker,
        content: result.content?.trim() || "No additional findings.",
        model,
        activity,
      };
    }

    messages.push({
      role: "assistant",
      content: result.content,
      tool_calls: result.toolCalls,
    });

    for (const call of result.toolCalls.slice(0, 4)) {
      const semanticName = call.function.name.replaceAll("__", ".");
      const outcome = await registry.execute(
        call.function.name,
        call.function.arguments,
        input.context,
        call.id,
      );
      activity.push({ tool: semanticName, ok: outcome.ok });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(outcome),
      });
    }
  }

  return {
    worker: input.worker,
    content: "The delegated worker reached its investigation limit. Review the returned activity and continue from the coordinator.",
    model,
    activity,
  };
}
