import { agentMailRegistry } from "../ai/tools/registry.js";
import type { AgentRisk, AgentToolDefinition } from "../ai/tools/types.js";

/**
 * Single-source capability policy for ALL existing GSW AI tools.
 * This is metadata, not an authentication bypass. Transport must validate
 * OAuth resource, user identity, workspace ACLs and scoped permissions.
 */
export type McpAccessPolicy = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiredScopes: string[];
  risk: AgentRisk;
  approvalRequired: boolean;
};

export function classifyTool(tool: AgentToolDefinition): McpAccessPolicy {
  return {
    name: tool.name.replaceAll(".", "__"),
    description: tool.description,
    inputSchema: tool.inputSchema,
    requiredScopes: [...tool.requiredScopes],
    risk: tool.risk,
    approvalRequired: tool.risk !== "read",
  };
}

/** No static allowlist: capabilities introduced in the registry are discoverable. */
export function allMcpCapabilities(): McpAccessPolicy[] {
  return agentMailRegistry.definitions().map(classifyTool);
}

/** Connection-specific visibility MUST NOT replace per-call authorization. */
export function scopedMcpCapabilities(scopes: ReadonlySet<string>): McpAccessPolicy[] {
  return allMcpCapabilities().filter(tool => tool.requiredScopes.every(s => scopes.has(s)));
}

export function authorizeMcpInvocation(input: {
  toolName: string;
  scopes: ReadonlySet<string>;
  approved: boolean;
  allowExternal: boolean;
}): { allowed: true; tool: McpAccessPolicy } | { allowed: false; reason: string } {
  const tool = allMcpCapabilities().find(t => t.name === input.toolName);
  if (!tool) return { allowed: false, reason: "unknown_tool" };
  if (!tool.requiredScopes.every(s => input.scopes.has(s))) return { allowed: false, reason: "insufficient_scope" };
  if (tool.risk === "external" && !input.allowExternal) return { allowed: false, reason: "external_actions_disabled" };
  if (tool.approvalRequired && !input.approved) return { allowed: false, reason: "approval_required" };
  return { allowed: true, tool };
}
