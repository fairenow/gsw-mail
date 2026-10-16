import type { AgentToolDefinition } from "../ai/tools/types.js";

/**
 * MCP permissions must be the intersection of an external OAuth grant and
 * the effective permissions already assigned to this user within GSW.
 * All access is resolved afresh for each request; not cached in the MCP token.
 */
export interface EffectiveGswAuthorization {
  userId: string;
  accountId: string;
  grantedScopes: ReadonlySet<string>;
  /** Existing account settings and current mailbox/org memberships. */
  allowedScopes: ReadonlySet<string>;
  /** Approval verified by GSW's own persisted approval workflow. */
  approvedToolCalls: ReadonlySet<string>;
}

export function mayInvokeSharedTool(
  tool: AgentToolDefinition,
  auth: EffectiveGswAuthorization,
  toolCallId: string,
): { allowed: boolean; reason?: string } {
  if (!auth.userId || !auth.accountId) return { allowed: false, reason: "missing_identity" };
  for (const scope of tool.requiredScopes) {
    if (!auth.grantedScopes.has(scope)) return { allowed: false, reason: "oauth_scope_missing" };
    if (!auth.allowedScopes.has(scope)) return { allowed: false, reason: "user_permission_denied" };
  }
  if (tool.risk !== "read" && !auth.approvedToolCalls.has(toolCallId)) {
    return { allowed: false, reason: "approval_required" };
  }
  return { allowed: true };
}
