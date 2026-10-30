import { createRemoteJWKSet } from "jose";
import { config } from "../config.js";
import { loadMailboxCredential } from "./mailboxCredentialVault.js";
import { verifyStalwartMailboxJwt } from "./verifyStalwartMailboxJwt.js";
import type { TrustedMailboxPrincipal } from "./trustedMailboxCredential.js";

const jwks = createRemoteJWKSet(new URL(`${config.auth.issuer}/jwks`));
export async function findStoredStalwartMailboxToken(input: TrustedMailboxPrincipal): Promise<string | null> {
  const credential = await loadMailboxCredential(input);
  if (!credential) return null;
  try {
    await verifyStalwartMailboxJwt(credential.accessToken, input, jwks, { issuer: config.auth.issuer, audience: config.auth.stalwartAudience, mailboxAddress: credential.address });
    return credential.accessToken;
  } catch { return null; }
}
