/** The first delegated AI release is deliberately read-only. */
const readTools = new Set(["mail.list_recent", "mail.search", "mail.read", "mail.read_thread", "mail.list_folders", "templates.list", "templates.get", "campaign.list", "campaign.read", "campaign.report"]);
export function communityAiToolAllowed(tool: {name:string;requiredScopes:readonly string[];risk?:string}, scopes: ReadonlySet<string>) {
  return readTools.has(tool.name) && (tool.risk === undefined || tool.risk === "read") && tool.requiredScopes.every(scope => scopes.has(scope));
}
export function communityAiClientAllowed(clientId:string, scopes:ReadonlySet<string>, configuredClient:string|undefined) {
  return Boolean(configuredClient && clientId === configuredClient && scopes.has("ai.infer"));
}
