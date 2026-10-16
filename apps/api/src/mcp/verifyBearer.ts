import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { users, oauthConsent, oauthClient } from "../db/schema.js";
import { and, eq } from "drizzle-orm";
import { consentPermitsMcpToken } from "./consentPolicy.js";
import { canonicalMcpOAuthScopes } from "./scopeAliases.js";

/**
 * This verifier never accepts GSW's first-party Stalwart/mobile audience.
 * A dedicated third-party MCP resource token is required.
 */
const resource=()=>process.env.GSW_MCP_RESOURCE_URL ?? `${config.auth.baseUrl.replace(/\/$/,"")}/mcp`;
const jwks=createRemoteJWKSet(new URL(`${config.auth.issuer}/jwks`));
export async function verifyMcpBearer(token:string):Promise<{
 userId:string; authUserId:string; oauthScopes:Set<string>; clientId:string;
} | null> {
  if(!token||token.length>8192||token.split(".").length!==3)return null;
  try {
    const {payload}=await jwtVerify(token,jwks,{issuer:config.auth.issuer,audience:resource()});
    const clientId=typeof payload.client_id==="string"?payload.client_id:typeof payload.azp==="string"?payload.azp:"";
    if(!clientId||typeof payload.sub!=="string")return null;
    const scopes=new Set(typeof payload.scope==="string"?payload.scope.split(/\s+/).filter(Boolean):[]);
    if(!scopes.has("openid"))return null;
    // Use the existing internal subject mapping; never trust a user ID in request parameters.
    const [resolved]=await db.select({id:users.id,status:users.status}).from(users).where(eq(users.authUserId,payload.sub)).limit(1);
    if(!resolved || resolved.status!=="active")return null;
    // Connection revocation is enforced even for previously issued JWTs.
    const [consent]=await db.select({scopes:oauthConsent.scopes, disabled:oauthClient.disabled}).from(oauthConsent)
      .innerJoin(oauthClient,eq(oauthConsent.clientId,oauthClient.clientId))
      .where(and(eq(oauthConsent.userId,payload.sub),eq(oauthConsent.clientId,clientId),eq(oauthClient.disabled,false)))
      .limit(1);
    if(!consentPermitsMcpToken({tokenScopes:scopes,consentScopes:consent?.scopes??null,clientDisabled:consent?.disabled===true}))return null;
    return {userId:resolved.id,authUserId:payload.sub,oauthScopes:canonicalMcpOAuthScopes(scopes),clientId};
  }catch{return null;}
}
