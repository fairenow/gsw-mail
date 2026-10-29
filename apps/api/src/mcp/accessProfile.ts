import { and, eq, or, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { authUsers, emailAccounts, mailAccountMemberships, organizationMemberships } from "../db/schema.js";
import { aiScopes } from "../ai/permissions/types.js";
export type McpAccountMode = "admin" | "mailbox" | "identity";
export const adminScopes = new Set(["workspace.read", "workspace.admin", "domain.read", "domain.write", "alias.read", "alias.write", "mailbox_admin.read", "mailbox_admin.write", "admin.health.read", "admin.audit.read"]);
export const identityScopes = new Set(["openid", "email", "profile", "offline_access"]);
export function scopeAllowedForMode(mode: McpAccountMode, scope: string): boolean {
  if (identityScopes.has(scope)) return true;
  if (mode === "identity") return false;
  if (scope === "automation.read" || scope === "automation.write") return mode === "mailbox";
  return (aiScopes as readonly string[]).includes(scope) && (mode === "admin" ? adminScopes.has(scope) : !adminScopes.has(scope));
}
export function selectMcpAccountMode(hasMailboxIdentity: boolean, hasAdminMembership: boolean): McpAccountMode {
  return hasMailboxIdentity ? "mailbox" : hasAdminMembership ? "admin" : "identity";
}
export async function resolveMcpAccessProfile(userId: string, authUserId: string) {
  const [identity] = await db.select({ email: authUsers.email }).from(authUsers).where(eq(authUsers.id, authUserId)).limit(1);
  const bindings = identity ? await db.select({ id: emailAccounts.id }).from(emailAccounts).leftJoin(mailAccountMemberships, eq(mailAccountMemberships.accountId,emailAccounts.id)).where(and(sql`lower(${emailAccounts.address}) = ${identity.email.toLowerCase()}`, or(eq(emailAccounts.userId,userId), and(eq(mailAccountMemberships.userId,userId),eq(mailAccountMemberships.authUserId,authUserId))))).limit(1) : [];
  const memberships = await db.select({ role: organizationMemberships.role, status: organizationMemberships.status }).from(organizationMemberships).where(eq(organizationMemberships.userId, userId));
  const mode = selectMcpAccountMode(bindings.length > 0, Boolean(identity) && memberships.some(row => row.status === "active" && (row.role === "owner" || row.role === "admin")));
  return { mode, allowedScopes: [...identityScopes, ...aiScopes.filter(scope => scopeAllowedForMode(mode, scope))] };
}
export function toolAllowedForMode(mode: McpAccountMode, name: string, scopes: readonly string[] = []): boolean {
  if (["get_current_user", "list_capabilities"].includes(name)) return true;
  if (["list_admin_workspaces", "list_admin_domains", "list_admin_mailboxes", "create_admin_mailbox"].includes(name)) return mode === "admin" && scopes.every(scope => scopeAllowedForMode(mode, scope));
  return mode === "mailbox" && scopes.every(scope => scopeAllowedForMode(mode, scope));
}
