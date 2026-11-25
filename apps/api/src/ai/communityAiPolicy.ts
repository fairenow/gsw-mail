/** Native read tools and explicitly reviewed draft operations; the model cannot send on its own. */
const readTools = new Set(["mail.list_recent","mail.search","mail.read","mail.read_thread","mail.list_folders","mail.activity","templates.list","templates.get","contacts.search","contacts.tags","contacts.audience.preview","calendar.list","calendar.events.list","calendar.availability","calendar.rsvp.status","calendar.events.preview_change","files.list","files.search","files.read","files.analyze","campaign.list","campaign.read","campaign.report","campaign.preview","automations.list","tasks.list","tasks.read","files.list_folder","files.search_nodes","files.organize_preview","integrations.list"]);
const reviewedTools=new Set(["mail.update_draft","mail.reply","mail.reply_all","mail.forward","mail.star","mail.move","mail.create_folder","contacts.create","contacts.update","contacts.tags.assign","templates.create","templates.update","templates.duplicate","templates.select","files.create_text","files.create_artifact","files.transform","files.generate_image","files.edit_image","files.create_folder","files.rename_node","files.move_node","files.restore_node","mail.attach_file","campaign.create","campaign.draft.edit","campaign.audience.edit"]);
export function communityAiToolAllowed(tool: {name:string;requiredScopes:readonly string[];risk?:string}, scopes: ReadonlySet<string>) {
  return readTools.has(tool.name) && (tool.risk === undefined || tool.risk === "read") && tool.requiredScopes.every(scope => scopes.has(scope));
}
export function communityAiClientAllowed(clientId:string, scopes:ReadonlySet<string>, configuredClient:string|undefined) {
  return Boolean(configuredClient && clientId === configuredClient && scopes.has("ai.infer"));
}

export function communityAiProposalAllowed(tool:{name:string;requiredScopes:readonly string[];risk?:string},scopes:ReadonlySet<string>){
 return tool.name==="mail.create_draft"&&tool.risk==="reversible_write"&&tool.requiredScopes.every(scope=>scopes.has(scope));
}

/** A reviewed native write is never an arbitrary model-selected execution. */
export function communityAiActionAllowed(tool:{name:string;requiredScopes:readonly string[];risk?:string},scopes:ReadonlySet<string>){
 return reviewedTools.has(tool.name)&&tool.risk==="reversible_write"&&tool.requiredScopes.every(scope=>scopes.has(scope));
}
export function parseCommunityActionArguments(raw:string):Record<string,unknown>|null{
 if(raw.length>100000)return null;
 try{
   const value:unknown=JSON.parse(raw);
   if(!value||typeof value!=="object"||Array.isArray(value))return null;
   return value as Record<string,unknown>;
 }catch{return null;}
}
