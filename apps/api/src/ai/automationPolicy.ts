import type { AgentToolDefinition } from "./tools/types.js";

/**
 * Server-side background authorization. An automation's scopes are a ceiling,
 * not a substitute for current grants or mailbox membership.
 */
// Only non-sending, reversible, user-scoped operations may run unattended.
const SCHEDULED_WRITES = new Set(["mail.create_draft", "files.create_text", "campaign.create"]);

const NEVER_UNATTENDED = new Set([
  "mail.send", "campaign.send", "browser.write", "workspace.admin",
  "domain.write", "alias.write", "mailbox_admin.write",
  "settings.write", "automations.write", "tasks.write",
]);

export function mayRunScheduledTool(
  tool: AgentToolDefinition,
  allowedScopes: readonly string[],
  activeScopes: readonly string[],
  sendApproved = false,
): boolean {
  if (tool.name === "mail.send_draft") return sendApproved && tool.requiredScopes.every(scope => allowedScopes.includes(scope) && activeScopes.includes(scope));
  if (tool.risk === "external") return false;
  if (tool.risk === "reversible_write" && !SCHEDULED_WRITES.has(tool.name)) return false;
  if (tool.requiredScopes.some(scope => NEVER_UNATTENDED.has(scope))) return false;
  return tool.requiredScopes.every(scope =>
    allowedScopes.includes(scope) && activeScopes.includes(scope));
}

export function scheduledToolDefinitions(
  tools: readonly AgentToolDefinition[],
  allowedScopes: readonly string[],
  activeScopes: readonly string[],
  sendApproved = false,
): AgentToolDefinition[] {
  return tools.filter(tool => mayRunScheduledTool(tool, allowedScopes, activeScopes, sendApproved));
}
