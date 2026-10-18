import { jwtVerify } from "jose";
import type { TrustedMailboxPrincipal } from "./trustedMailboxCredential.js";

/**
 * Verify a Stalwart-resource JWT before it is usable by a mail engine.
 * The key must be trusted (normally Better Auth JWKS), never taken from token
 * headers or a client-supplied URL. This intentionally does not accept opaque
 * tokens; those require a separate authoritative introspection strategy.
 */
export async function verifyStalwartMailboxJwt(
  token: string,
  principal: TrustedMailboxPrincipal,
  key: Parameters<typeof jwtVerify>[1],
  options: { issuer: string; audience: string; mailboxAddress: string },
): Promise<void> {
  if (!token || token.length > 8192 || token.split(".").length !== 3) {
    throw new Error("invalid_mailbox_token");
  }
  const { payload } = await jwtVerify(token, key, {
    issuer: options.issuer,
    audience: options.audience,
    algorithms: ["ES256", "RS256"],
  });
  const scopes = typeof payload.scope === "string" ? payload.scope.split(/\s+/) : [];
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const expectedAddress = options.mailboxAddress.trim().toLowerCase();
  if (!expectedAddress || !email || email !== expectedAddress ||
      typeof payload.exp !== "number" || payload.sub !== principal.authUserId || !scopes.includes("email")) {
    throw new Error("mailbox_token_claims_mismatch");
  }
}
