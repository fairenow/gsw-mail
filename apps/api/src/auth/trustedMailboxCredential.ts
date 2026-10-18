/**
 * Transport-neutral boundary for future server-side mailbox credentials.
 * This module does not mint tokens or bypass Better Auth's resource audience.
 * Callers must supply an authoritative authorization check and a separately
 * reviewed issuer that returns a Stalwart-scoped credential.
 */
export interface TrustedMailboxPrincipal {
  productUserId: string;
  authUserId: string;
  accountId: string;
}

export interface TrustedMailboxCredentialDependencies {
  authorize: (principal: TrustedMailboxPrincipal, permission: "read" | "send") => Promise<void>;
  issue: (principal: TrustedMailboxPrincipal) => Promise<{ token: string; authUserId: string; accountId: string }>;
  verify: (token: string, principal: TrustedMailboxPrincipal) => Promise<void>;
}

export async function resolveTrustedMailboxCredential(
  principal: TrustedMailboxPrincipal,
  permission: "read" | "send",
  dependencies: TrustedMailboxCredentialDependencies,
): Promise<string> {
  if (!principal.productUserId || !principal.authUserId || !principal.accountId) {
    throw new Error("mailbox_identity_required");
  }
  await dependencies.authorize(principal, permission);
  const issued = await dependencies.issue(principal);
  if (issued.authUserId !== principal.authUserId || issued.accountId !== principal.accountId || !issued.token) {
    throw new Error("mailbox_credential_binding_mismatch");
  }
  await dependencies.verify(issued.token, principal);
  return issued.token;
}
