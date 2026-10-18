import { config } from "../config.js";

/**
 * OAuth clients this product itself operates and trusts to hold a Stalwart
 * mailbox credential. A third-party MCP client is never included; its token is
 * only an authorization to call GSW, never a mailbox credential.
 */
export function firstPartyStalwartClientIds(): string[] {
  return [config.auth.mobileClientId, config.auth.oauthClientId]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}
