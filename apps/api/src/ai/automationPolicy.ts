import type { AgentToolDefinition } from "./tools/types.js";

/**
 * Server-side background authorization. An automation's scopes are a ceiling,
 * not a substitute for current grants or mailbox membership.
 */
const NEVER_UNATTENDED = new Set([
  "mail.send", "campaign.send", "browser.write", "workspace.admin",
  "domain.write", "alias.write", "mailbox_admin.write",
  "settings.write", "automations.write", "tasks.write",
]);

export function mayRunScheduledTool(
  tool: AgentToolDefinition,
  allowedScopes: readonly string[],
  activeScopes: readonly string[],
): boolean {
  if (tool.risk !== "read") return false;
  if (tool.requiredScopes.some(scope => NEVER_UNATTENDED.has(scope))) return false;
  return tool.requiredScopes.every(scope =>
    allowedScopes.includes(scope) && activeScopes.includes(scope));
}

export function scheduledToolDefinitions(
  tools: readonly AgentToolDefinition[],
  allowedScopes: readonly string[],
  activeScopes: readonly string[],
): AgentToolDefinition[] {
  return tools.filter(tool => mayRunScheduledTool(tool, allowedScopes, activeScopes));
}
