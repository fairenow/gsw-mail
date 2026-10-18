import { listActiveAiScopes } from "../ai/agentState.js";
import { getAiCapabilitySettings, isAiScopeGloballyEnabled } from "../ai/capabilities.js";
import { requireAccountPermission } from "../auth/authorize.js";
import { agentMailRegistry } from "../ai/tools/registry.js";
import { requiredMailboxPermission } from "../ai/mailboxToolPermission.js";
import type { AgentToolDefinition } from "../ai/tools/types.js";

/** Resolve live GSW grants and settings at invocation time, not from cached MCP claims. */
export async function resolveMcpUserToolPermission(input: {
  userId: string; accountId: string; oauthScopes: ReadonlySet<string>;
  toolName: string;
}): Promise<{ allowed: true; tool: AgentToolDefinition } | { allowed: false; reason: string }> {
  const tool=agentMailRegistry.definition(input.toolName);
  if(!tool) return {allowed:false,reason:"unknown_tool"};
  if(!input.userId || !input.accountId) return {allowed:false,reason:"identity_required"};
  if(!tool.requiredScopes.every(scope=>input.oauthScopes.has(scope))) return {allowed:false,reason:"oauth_scope_missing"};
  const settings=await getAiCapabilitySettings(input.userId);
  if(!tool.requiredScopes.every(scope=>isAiScopeGloballyEnabled(settings,scope))) return {allowed:false,reason:"capability_disabled"};
  const granted=new Set((await listActiveAiScopes(input.userId,input.accountId)).map(item=>item.scope));
  if(!tool.requiredScopes.every(scope=>granted.has(scope))) return {allowed:false,reason:"user_permission_denied"};
  try {
    await requireAccountPermission(input.userId,input.accountId,requiredMailboxPermission(tool.requiredScopes));
  } catch {
    return {allowed:false,reason:"account_access_denied"};
  }
  return {allowed:true,tool};
}
