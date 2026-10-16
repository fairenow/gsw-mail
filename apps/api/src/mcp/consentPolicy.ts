/** Keep consent checks independent from transport and SQL so they can be tested. */
export function consentPermitsMcpToken(input: {
  tokenScopes: ReadonlySet<string>;
  consentScopes: readonly string[] | null;
  clientDisabled: boolean;
}): boolean {
  if (input.clientDisabled || !input.consentScopes) return false;
  const approved = new Set(input.consentScopes);
  // Scope downgrades take effect on the next request, even for signed JWTs.
  return [...input.tokenScopes].every(scope => approved.has(scope));
}
