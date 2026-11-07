/**
 * Persistent MCP mailbox credentials must use a first-party confidential
 * OAuth client distinct from the mobile application. A mobile refresh-token
 * rotation or logout must never revoke the MCP broker's grant.
 */
export function selectBrokerClient(input: {
  clientId?: string;
  clientSecret?: string;
  redirectUri: string;
  mobileClientId: string;
}): { clientId: string; clientSecret: string; redirectUri: string } | null {
  const clientId = input.clientId?.trim();
  const clientSecret = input.clientSecret?.trim();
  const redirectUri = input.redirectUri.trim();
  if (!clientId || !clientSecret || clientId === input.mobileClientId || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}
