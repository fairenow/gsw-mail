import type { AgentExecutionContext, AgentToolDefinition, ProviderToolDefinition } from "./types.js";
import { agentMailTools, readOnlyMailTools } from "./mailTools.js";
import { automationTools } from "./automationTools.js";
import { searchTools } from "./searchTools.js";
import { campaignTools } from "./campaignTools.js";
import { contactTools } from "./contactTools.js";
import { templateTools } from "./templateTools.js";
import { domainTools } from "./domainTools.js";
import { fileTools } from "./fileTools.js";
import { taskTools } from "./taskTools.js";
import { workerTools } from "./workerTools.js";
import { integrationTools } from "./integrationTools.js";

export class AgentToolRegistry {
  private readonly tools = new Map<string, AgentToolDefinition>();

  constructor(definitions: AgentToolDefinition[]) {
    for (const definition of definitions) this.tools.set(definition.name, definition);
  }

  definition(name: string): AgentToolDefinition | undefined {
    return this.tools.get(name.replaceAll("__", "."));
  }

  definitions(): AgentToolDefinition[] {
    return [...this.tools.values()];
  }

  search(query: string, limit = 12): AgentToolDefinition[] {
    const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length > 1);
    if (terms.length === 0) return this.definitions().slice(0, limit);
    return this.definitions()
      .map((tool) => {
        const haystack = `${tool.name} ${tool.description} ${tool.requiredScopes.join(" ")}`.toLowerCase();
        const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
        return { tool, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
      .slice(0, Math.max(1, Math.min(limit, 30)))
      .map((entry) => entry.tool);
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

const baseAgentTools: AgentToolDefinition[] = [...agentMailTools, ...automationTools, ...taskTools, ...workerTools, ...integrationTools, ...searchTools, ...contactTools, ...campaignTools, ...templateTools, ...domainTools, ...fileTools];
const baseAgentRegistry = new AgentToolRegistry(baseAgentTools);

const capabilitySearchTool: AgentToolDefinition = {
  name: "capabilities.search",
  description: "Search GSW's available agent capabilities when the current toolset is missing something needed for the user's request. Use concise capability words such as calendar, campaign, files, domain, contacts, research, or email.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Capability or action to find." },
      limit: { type: "number", minimum: 1, maximum: 20 },
    },
    required: ["query"],
    additionalProperties: false,
  },
  requiredScopes: [],
  risk: "read",
  async execute(ctx, input, toolCallId) {
    const startedAt = new Date().toISOString();
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const query = typeof value.query === "string" ? value.query.trim() : "";
    const limit = typeof value.limit === "number" ? Math.max(1, Math.min(Math.trunc(value.limit), 20)) : 12;
    const matches = query ? baseAgentRegistry.search(query, limit) : baseAgentRegistry.definitions().slice(0, limit);
    return {
      ok: true,
      toolCallId,
      data: {
        query,
        tools: matches.map((tool) => ({
          name: tool.name,
          description: tool.description,
          requiredScopes: tool.requiredScopes,
          risk: tool.risk,
        })),
      },
      audit: {
        userId: ctx.userId,
        accountId: ctx.accountId,
        startedAt,
        completedAt: new Date().toISOString(),
      },
    };
  },
};

export const agentMailRegistry = new AgentToolRegistry([...baseAgentTools, capabilitySearchTool]);
export const readOnlyMailRegistry = new AgentToolRegistry(readOnlyMailTools);
