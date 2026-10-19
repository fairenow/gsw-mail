/**
 * Selects a renewed persisted credential only after a caller-supplied refresh
 * and account-binding verification both succeed. Candidates must already be
 * filtered by principal, first-party client, revocation and expiry.
 * A refresh failure or unverifiable token is skipped; never fall back to an
 * unverified or non-refreshable credential.
 */
export async function selectRefreshedStoredToken(
  candidates: ReadonlyArray<{ clientId: string; token: string; scopes: readonly string[] }>,
  refresh: (candidate: { clientId: string; token: string }) => Promise<string>,
  verify: (token: string) => Promise<void>,
  onFailure?: (stage: "exchange" | "verification") => void,
): Promise<string | null> {
  for (const candidate of candidates) {
    if (!candidate.token || !candidate.scopes.includes("email")) continue;
    let token: string;
    try {
      token = await refresh({ clientId: candidate.clientId, token: candidate.token });
    } catch {
      onFailure?.("exchange");
      continue;
    }
    try {
      await verify(token);
      return token;
    } catch {
      onFailure?.("verification");
      // Never return an unverified mailbox credential.
    }
  }
  return null;
}
