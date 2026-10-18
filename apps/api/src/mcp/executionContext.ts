import type { AgentExecutionContext } from "../ai/tools/types.js";
import { mcpOutboundIdempotencyKey } from "./outboundIdempotency.js";

/**
 * Trusted context for an already authenticated and authorized MCP invocation.
 * The external MCP OAuth token is never forwarded as a Stalwart bearer.
 *
 * Credential brokerage remains a separate Phase 2 concern.
 */
export function createMcpExecutionContext(
  identity: { userId: string; authUserId: string },
  accountId: string,
  options?: { toolName: string; reservedActionKey: string },
): AgentExecutionContext {
  const outboundKey = options
    ? mcpOutboundIdempotencyKey(options.toolName, options.reservedActionKey)
    : undefined;
  return {
    userId: identity.userId,
    authUserId: identity.authUserId,
    accountId,
    headers: {},
    ...(outboundKey ? { scheduledIdempotencyKey: outboundKey } : {}),
  };
}
