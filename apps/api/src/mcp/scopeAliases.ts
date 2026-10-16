/**
 * Backward-compatible OAuth names accidentally advertised by early MCP metadata.
 * Keep canonical scope names in discovery and tool permissions.
 */
export const legacyMcpOAuthScopes = ["automation.read", "automation.write"] as const;

export function canonicalMcpOAuthScope(scope: string): string {
  if (scope === "automation.read") return "automations.read";
  if (scope === "automation.write") return "automations.write";
  return scope;
}

export function canonicalMcpOAuthScopes(scopes: Iterable<string>): Set<string> {
  return new Set([...scopes].map(canonicalMcpOAuthScope));
}
