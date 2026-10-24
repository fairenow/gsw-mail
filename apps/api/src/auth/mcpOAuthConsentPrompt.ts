import { aiScopes } from "../ai/permissions/types.js";

/**
 * External MCP clients must show an explicit permission review on every new
 * authorization. Better Auth normally reuses an earlier consent for the same
 * client and scope set. Adding the standard OAuth "consent" prompt *before*
 * Better Auth validates/signs the authorization request ensures that a new
 * account choice cannot silently reuse stale permission UI.
 *
 * Never mutate the signed oauth_query used by login/consent continuations.
 * Exempt GSW's first-party clients and prompt=none (unattended authorization).
 */
export function requireFreshExternalMcpConsent(
  authorizeUrl: string,
  firstPartyClientIds: ReadonlySet<string>,
): string {
  const url = new URL(authorizeUrl);
  if (url.pathname !== "/api/auth/oauth2/authorize") return authorizeUrl;
  const clientId = url.searchParams.get("client_id");
  if (!clientId || firstPartyClientIds.has(clientId)) return authorizeUrl;

  const requested = new Set((url.searchParams.get("scope") ?? "").split(/\s+/).filter(Boolean));
  const isMcpRequest = [...requested].some(scope => (aiScopes as readonly string[]).includes(scope)) ||
    url.searchParams.getAll("resource").some(resource => {
      try { return new URL(resource).pathname.replace(/\/$/, "") === "/mcp"; }
      catch { return false; }
    });
  if (!isMcpRequest) return authorizeUrl;

  const prompts = (url.searchParams.get("prompt") ?? "").split(/\s+/).filter(Boolean);
  if (prompts.includes("none") || prompts.includes("consent")) return authorizeUrl;

  url.searchParams.set("prompt", [...prompts, "consent"].join(" "));
  return url.toString();
}
