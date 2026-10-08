import type { AgentExecutionContext, AgentToolDefinition, AgentToolResult } from "./types.js";
import { listAgentIntegrations } from "../integrations.js";

export const integrationsListTool: AgentToolDefinition = {
  name: "integrations.list",
  description: "List the GSW integrations and provider capabilities currently configured for this deployment. Use this when deciding whether a requested workflow can use an external system or specialized service.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  requiredScopes: [],
  risk: "read",
  async execute(ctx: AgentExecutionContext, _input, toolCallId): Promise<AgentToolResult> {
    const startedAt = new Date().toISOString();
    return {
      ok: true,
      toolCallId,
      data: { integrations: listAgentIntegrations() },
      audit: {
        userId: ctx.userId,
        accountId: ctx.accountId,
        startedAt,
        completedAt: new Date().toISOString(),
      },
    };
  },
};

export const integrationTools: AgentToolDefinition[] = [integrationsListTool];
