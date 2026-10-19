/** Public write rollout is opt-in and limited to operations supported by the
 * first-party persisted approval flow. Other writes remain owner-test only.
 * Never trust an MCP caller's claimed role or a confirmation boolean alone. */
export function publicMcpWriteDecision(input: {
  enabled?: string;
  approvalId?: unknown;
  toolName: string;
  risk: "read" | "reversible_write" | "external";
}): { allowed: true } | { allowed: false; reason: string } {
  if (input.enabled !== "true") return { allowed: false, reason: "public_writes_disabled" };
  if (input.risk !== "reversible_write" || input.toolName.replaceAll("__", ".") !== "mail.create_draft")
    return { allowed: false, reason: "public_write_tool_not_approved" };
  if (typeof input.approvalId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.approvalId))
    return { allowed: false, reason: "persisted_approval_required" };
  return { allowed: true };
}
