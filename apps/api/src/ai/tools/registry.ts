import type { AgentExecutionContext, AgentToolDefinition, ProviderToolDefinition } from "./types.js";
import { readOnlyMailTools } from "./mailTools.js";

export class AgentToolRegistry {
  private readonly tools = new Map<string, AgentToolDefinition>();

  constructor(definitions: AgentToolDefinition[]) {
    for (const definition of definitions) this.tools.set(definition.name, definition);
  }

  providerDefinitions(): ProviderToolDefinition[] {
    return [...this.tools.values()].map((tool) => ({
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

export const readOnlyMailRegistry = new AgentToolRegistry(readOnlyMailTools);
