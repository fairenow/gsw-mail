/** Administrative writes require an independent, explicit opt-in.
 * A mailbox write-test flag cannot enable workspace management.
 */
export function adminMailboxWriteGate(input: {
  enabled: string | undefined;
  persistedApprovalRequired: string | undefined;
  hasWriteScope: boolean;
}): { allowed: true } | { allowed: false; reason: string } {
  if (!input.hasWriteScope) return { allowed: false, reason: "oauth_scope_missing" };
  if (input.enabled !== "true") return { allowed: false, reason: "admin_writes_disabled" };
  if (input.persistedApprovalRequired === "true")
    return { allowed: false, reason: "workspace_approval_not_supported" };
  return { allowed: true };
}
