import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "../config.js";
import { resolveOrProvisionUser } from "../auth/middleware.js";

/**
 * This verifier never accepts GSW's first-party Stalwart/mobile audience.
 * A dedicated third-party MCP resource token is required.
 */
const resource=()=>`${config.auth.baseUrl.replace(/\/$/,"")}/mcp`;
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
    const resolved=await resolveOrProvisionUser(config.auth.identityProvider,payload.sub);
    return {userId:resolved.user.id,authUserId:payload.sub,oauthScopes:scopes,clientId};
  }catch{return null;}
}
