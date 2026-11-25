import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { oauthClient } from "../db/schema.js";
import { config } from "../config.js";

export const communityOAuthScopes=["openid","email","profile","offline_access","mail.read","mail.write","mail.send","templates.read","signatures.read","ai.infer","campaign.read","campaign.write","campaign.send","contacts.read","contacts.write","calendar.read","calendar.write","templates.write","files.read","files.write","images.generate","automations.read","tasks.read"];
export async function ensureCommunityOAuthClient():Promise<"not_configured"|"registered"|"existing"|"conflict">{
 const clientId=process.env.GSW_COMMUNITY_OAUTH_CLIENT_ID,redirect=process.env.GSW_COMMUNITY_OAUTH_REDIRECT_URI;
 if(!clientId||!redirect)return "not_configured";
 let callback:URL;
 try{callback=new URL(redirect);}catch{return "conflict";}
 if(callback.protocol!=="https:"||callback.pathname!=="/admin/mail"||callback.username||callback.password||callback.search||callback.hash||clientId===config.auth.mobileClientId||clientId===config.auth.oauthClientId)return "conflict";
 const [existing]=await db.select().from(oauthClient).where(eq(oauthClient.clientId,clientId)).limit(1);
 if(existing){
   // Do not take over another client's ID, re-enable a disabled client or replace a redirect.
   if(existing.name!=="Guided Steps Wellness: The Community"||existing.disabled||existing.skipConsent!==false||existing.requirePKCE!==true||existing.tokenEndpointAuthMethod!=="none"||existing.redirectUris.length!==1||existing.redirectUris[0]!==redirect||existing.public!==true)return "conflict";
   await db.update(oauthClient).set({scopes:communityOAuthScopes,updatedAt:new Date()}).where(eq(oauthClient.clientId,clientId));
   return "existing";
 }
 await db.insert(oauthClient).values({id:randomUUID(),clientId,clientSecret:null,redirectUris:[redirect],scopes:communityOAuthScopes,name:"Guided Steps Wellness: The Community",uri:callback.origin,grantTypes:["authorization_code","refresh_token"],responseTypes:["code"],skipConsent:false,requirePKCE:true,disabled:false,public:true,tokenEndpointAuthMethod:"none",type:"web",createdAt:new Date(),updatedAt:new Date()}).onConflictDoNothing({target:oauthClient.clientId});
 return "registered";
}
