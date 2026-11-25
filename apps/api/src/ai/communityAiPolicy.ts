/** Native read tools and explicitly reviewed draft operations; the model cannot send on its own. */
const readTools = new Set(["mail.list_recent", "mail.search", "mail.read", "mail.read_thread", "mail.list_folders", "mail.activity", "templates.list", "templates.get", "contacts.search", "contacts.list", "calendar.list", "calendar.search"]);
export function communityAiToolAllowed(tool: {name:string;requiredScopes:readonly string[];risk?:string}, scopes: ReadonlySet<string>) {
  return readTools.has(tool.name) && (tool.risk === undefined || tool.risk === "read") && tool.requiredScopes.every(scope => scopes.has(scope));
}
export function communityAiClientAllowed(clientId:string, scopes:ReadonlySet<string>, configuredClient:string|undefined) {
  return Boolean(configuredClient && clientId === configuredClient && scopes.has("ai.infer"));
}

export function communityAiProposalAllowed(tool:{name:string;requiredScopes:readonly string[];risk?:string},scopes:ReadonlySet<string>){
 return tool.name==="mail.create_draft"&&tool.risk==="reversible_write"&&tool.requiredScopes.every(scope=>scopes.has(scope));
}
