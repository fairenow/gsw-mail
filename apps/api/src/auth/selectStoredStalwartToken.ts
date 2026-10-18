/**
 * Selects a reusable persisted credential only after caller-provided
 * cryptographic and account-binding verification succeeds.
 * Candidates must already be filtered by principal, client and expiry.
 */
export async function selectVerifiedStoredToken(
  candidates: ReadonlyArray<{ token: string; scopes: readonly string[] }>,
  verify: (token: string) => Promise<void>,
): Promise<string | null> {
  for (const candidate of candidates) {
    if (!candidate.scopes.includes("email") || !candidate.token) continue;
    try {
      await verify(candidate.token);
      return candidate.token;
    } catch {
      // Never fall back to an unverified token.
    }
  }
  return null;
}
