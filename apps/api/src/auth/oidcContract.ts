import { config } from "../config.js";

/**
 * Public GSW OIDC contract.
 *
 * - `sub` is the Better Auth user id (`auth_users.id`). It is opaque and must
 *   remain stable for the lifetime of the GSW identity. Email, mailbox address,
 *   product-user id, and upstream provider subjects must never replace it.
 * - `openid` identifies the user through `sub`.
 * - `email` releases `email` and `email_verified`.
 * - `profile` releases the provider's standard profile claims such as `name`
 *   and `picture` when present.
 * - `offline_access` remains supported for the existing GSW Mobile flow; it is
 *   not implied for future external clients.
 */
export const GSW_OIDC_SUPPORTED_SCOPES = ["openid", "profile", "email", "offline_access"] as const;
export const GSW_OAUTH_CONSENT_PAGE = "/oauth/consent" as const;

export type GswOidcScope = (typeof GSW_OIDC_SUPPORTED_SCOPES)[number];

export function gswOidcSubject(user: { id: string }): string {
  return user.id;
}

export function oidcClientIdFromJwt(jwt: unknown): string | undefined {
  if (!jwt || typeof jwt !== "object") return undefined;
  const claims = jwt as Record<string, unknown>;
  if (typeof claims.azp === "string" && claims.azp) return claims.azp;
  if (typeof claims.client_id === "string" && claims.client_id) return claims.client_id;
  return undefined;
}

export function isLegacyInternalOidcClient(clientId: string | undefined): boolean {
  if (!clientId) return false;
  return clientId === config.auth.mobileClientId || clientId === config.auth.oauthClientId;
}

/**
 * Preserve the existing internal Mobile/Stalwart UserInfo shape without making
 * these convenience claims part of the public OIDC contract. External clients
 * receive standard claims according to their granted scopes from Better Auth.
 */
export function legacyInternalUserInfoClaims(input: {
  clientId: string | undefined;
  scopes: string[];
  user: { email: string; name?: string | null };
}): Record<string, string> {
  if (!isLegacyInternalOidcClient(input.clientId) || !input.scopes.includes("email")) return {};
  return {
    email: input.user.email,
    ...(input.user.name ? { name: input.user.name } : {}),
    preferred_username: input.user.email,
  };
}
