import type { AgentExecutionContext, AgentToolDefinition, ProviderToolDefinition } from "./types.js";
import { agentMailTools, readOnlyMailTools } from "./mailTools.js";
import { automationTools } from "./automationTools.js";
import { searchTools } from "./searchTools.js";
import { campaignTools } from "./campaignTools.js";
import { contactTools } from "./contactTools.js";

export class AgentToolRegistry {
  private readonly tools = new Map<string, AgentToolDefinition>();

  constructor(definitions: AgentToolDefinition[]) {
    for (const definition of definitions) this.tools.set(definition.name, definition);
  }

  definition(name: string): AgentToolDefinition | undefined {
    return this.tools.get(name.replaceAll("__", "."));
  }

  providerDefinitions(include?: (tool: AgentToolDefinition) => boolean): ProviderToolDefinition[] {
    return [...this.tools.values()].filter((tool) => include ? include(tool) : true).map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name.replaceAll(".", "__"),
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  async execute(name: string, rawArguments: string, ctx: AgentExecutionContext, toolCallId: string) {
    const semanticName = name.replaceAll("__", ".");
    const tool = this.tools.get(semanticName);
    if (!tool) {
      return {
        ok: false,
        toolCallId,
        error: { code: "unknown_tool", message: `Unknown tool: ${semanticName}`, retryable: false },
        audit: { userId: ctx.userId, accountId: ctx.accountId, startedAt: new Date().toISOString(), completedAt: new Date().toISOString() },
      };
    }

    let parsed: unknown;
    try {
      parsed = rawArguments ? JSON.parse(rawArguments) : {};
    } catch {
      return {
        ok: false,
        toolCallId,
        error: { code: "invalid_arguments", message: "Tool arguments were not valid JSON.", retryable: false },
        audit: { userId: ctx.userId, accountId: ctx.accountId, startedAt: new Date().toISOString(), completedAt: new Date().toISOString() },
      };
    }
    return tool.execute(ctx, parsed, toolCallId);
  }
}

export const agentMailRegistry = new AgentToolRegistry([...agentMailTools, ...automationTools, ...searchTools, ...contactTools, ...campaignTools]);
export const readOnlyMailRegistry = new AgentToolRegistry(readOnlyMailTools);
