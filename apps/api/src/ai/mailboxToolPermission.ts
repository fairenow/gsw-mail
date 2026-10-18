/**
 * Canonical mailbox permission mapping for both native AI and MCP.
 * Mail writes and sends require send privileges; all other capabilities
 * retain the existing read-level mailbox membership check.
 */
export function requiredMailboxPermission(scopes: readonly string[]): "read" | "send" {
  return scopes.some((scope) => scope === "mail.send" || scope === "mail.write") ? "send" : "read";
}
