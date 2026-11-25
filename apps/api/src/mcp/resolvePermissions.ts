import { firstDisabledCapabilityScope, firstMissingCapabilityGrant } from "../ai/capabilityScopePolicy.js";
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
  if(Boolean(firstDisabledCapabilityScope(tool.requiredScopes,scope=>isAiScopeGloballyEnabled(settings,scope)))) return {allowed:false,reason:"capability_disabled"};
  try {
    const account=await requireAccountPermission(input.userId,input.accountId,requiredMailboxPermission(tool.requiredScopes));
    const granted=new Set((await listActiveAiScopes(input.userId,input.accountId)).filter(g=>!g.workspaceId||g.workspaceId===account.organizationId).map(item=>item.scope));
    if(Boolean(firstMissingCapabilityGrant(tool.requiredScopes,granted))) return {allowed:false,reason:"user_permission_denied"};
  } catch {
    return {allowed:false,reason:"account_access_denied"};
  }
  return {allowed:true,tool};
}

/** Discover capabilities from one live settings/grants snapshot, not N queries
 * per model round. Actual execution still rechecks each individual tool. */
export async function listMcpPermittedTools(input:{userId:string;accountId:string;oauthScopes:ReadonlySet<string>;tools:AgentToolDefinition[]}):Promise<Set<string>>{
 if(!input.userId||!input.accountId)return new Set();
 const [settings,grants,account]=await Promise.all([
  getAiCapabilitySettings(input.userId),listActiveAiScopes(input.userId,input.accountId),
  requireAccountPermission(input.userId,input.accountId,"read")
 ]);
 const granted=new Set(grants.filter(g=>!g.workspaceId||g.workspaceId===account.organizationId).map(g=>g.scope));
 return new Set(input.tools.filter(tool=>tool.requiredScopes.every(scope=>input.oauthScopes.has(scope))&&!firstDisabledCapabilityScope(tool.requiredScopes,scope=>isAiScopeGloballyEnabled(settings,scope))&&!firstMissingCapabilityGrant(tool.requiredScopes,granted)&&account.permissions.includes(requiredMailboxPermission(tool.requiredScopes))).map(tool=>tool.name));
}
