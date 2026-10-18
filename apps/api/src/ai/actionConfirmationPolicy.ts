import type { AgentRisk } from "./tools/types.js";
import { scopeConfirmationPolicy, type AiScope } from "./permissions/types.js";

/**
 * Shared confirmation classification only. Native AI and MCP must still
 * enforce their own authenticated and persisted approval mechanisms.
 */
export function requiresExplicitActionConfirmation(
  risk: AgentRisk,
  requiredScopes: readonly string[],
): boolean {
  if (risk === "external") return true;
  return requiredScopes.some(scope => {
    const policy = scopeConfirmationPolicy[scope as AiScope];
    return policy === "always" || (policy === "contextual" && risk === "external");
  });
}
