import {and,eq} from "drizzle-orm";
import {db} from "../db/client.js";
import {oauthConsent,oauthClient,users} from "../db/schema.js";
import {canonicalMcpOAuthScopes} from "../mcp/scopeAliases.js";
import {requireAccountPermission} from "../auth/authorize.js";
import {requireAiSubscription} from "../billing/aiAccess.js";
import {getAiCapabilitySettings,isAiScopeGloballyEnabled} from "./capabilities.js";
import {listActiveAiScopes} from "./agentState.js";
import {forbidden} from "../lib/errors.js";
import {communityAiToolAllowed} from "./communityAiPolicy.js";
export type CommunityAutomationGrant={clientId:string;consentId:string;authUserId:string;scopes:string[];eventGrant?:import("./communityEventAutomation.js").CommunityEventGrant};
export const unattendedReadScopes=["mail.read","calendar.read","contacts.read","templates.read","signatures.read","files.read","campaign.read","tasks.read"] as const;
const safeScopes=new Set<string>(unattendedReadScopes);
export function validateCommunityAutomationScopes(scopes:readonly string[]){
 if(!scopes.length||scopes.length>safeScopes.size||new Set(scopes).size!==scopes.length||!scopes.every(s=>safeScopes.has(s)))throw forbidden("Connected automations support only explicitly approved read scopes");
 return [...scopes];
}
export function communityScheduledToolAllowed(tool:{name:string;requiredScopes:readonly string[];risk?:string},scopes:ReadonlySet<string>){
 return tool.risk==="read"&&tool.requiredScopes.length>0&&tool.requiredScopes.every(s=>safeScopes.has(s))&&communityAiToolAllowed(tool,scopes);
}
async function consentFor(userId:string,authUserId:string,clientId:string){
 if(!clientId||clientId!==process.env.GSW_COMMUNITY_OAUTH_CLIENT_ID)throw forbidden("Connected automation client unavailable");
 const [row]=await db.select({id:oauthConsent.id,scopes:oauthConsent.scopes}).from(oauthConsent)
  .innerJoin(oauthClient,eq(oauthConsent.clientId,oauthClient.clientId))
  .innerJoin(users,eq(users.authUserId,oauthConsent.userId))
  .where(and(eq(users.id,userId),eq(users.status,"active"),eq(oauthConsent.userId,authUserId),eq(oauthConsent.clientId,clientId),eq(oauthClient.disabled,false))).limit(1);
 if(!row)throw forbidden("Connected automation consent was revoked");
 return {id:row.id,scopes:canonicalMcpOAuthScopes(new Set(row.scopes))};
}
export async function checkCommunityAutomationGrant(userId:string,accountId:string,grant:CommunityAutomationGrant){
 const scopes=validateCommunityAutomationScopes(grant.scopes);
 const consent=await consentFor(userId,grant.authUserId,grant.clientId);
 if(consent.id!==grant.consentId||!["openid","offline_access","ai.infer","automations.write",...scopes].every(s=>consent.scopes.has(s)))throw forbidden("Connected automation consent changed");
 const account=await requireAccountPermission(userId,accountId,"read");
 if(account.status!=="active"||account.authSetupStatus!=="ready")throw forbidden("Connected automation mailbox unavailable");
 await requireAiSubscription(userId,accountId);
 const settings=await getAiCapabilitySettings(userId);
 const grants=new Set((await listActiveAiScopes(userId,accountId)).filter(g=>!g.workspaceId||g.workspaceId===account.organizationId).map(g=>g.scope));
 if(!settings.enabled||!["automations.write",...scopes].every(s=>isAiScopeGloballyEnabled(settings,s)&&grants.has(s)))throw forbidden("Connected automation permission changed");
 return new Set(scopes);
}
export async function createCommunityAutomationGrant(identity:{userId:string;authUserId:string;clientId:string;oauthScopes:ReadonlySet<string>},accountId:string,requested:readonly string[]):Promise<CommunityAutomationGrant>{
 const scopes=validateCommunityAutomationScopes(requested);
 if(!["offline_access","ai.infer","automations.write",...scopes].every(s=>identity.oauthScopes.has(s)))throw forbidden("Connect again and approve the requested automation scopes");
 const consent=await consentFor(identity.userId,identity.authUserId,identity.clientId);
 const grant={clientId:identity.clientId,authUserId:identity.authUserId,consentId:consent.id,scopes};
 await checkCommunityAutomationGrant(identity.userId,accountId,grant);
 return grant;
}
