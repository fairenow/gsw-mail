/**
 * Carry the caller's reserved action identity to the authoritative outbound
 * send operation. Other tools keep their existing idempotency behavior.
 */
export function mcpOutboundIdempotencyKey(toolName: string, reservedKey: string): string | undefined {
  return toolName.replaceAll("__", ".") === "mail.send_draft" ? reservedKey : undefined;
}
