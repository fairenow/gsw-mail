import { createHash } from "node:crypto";
export const COMMUNITY_AUDIENCE_TAG="community:external-snapshot";
type Recipient={email:string;displayName:string|null;firstName?:string|null;communityUnsubscribeToken:string|null};
export function communitySnapshotDigest(title:string,subject:string,body:string,rows:Recipient[]) {
  return createHash("sha256").update(JSON.stringify([title,subject,body,rows.map(r=>[r.email,r.displayName,r.firstName??null,r.communityUnsubscribeToken]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))] )).digest("hex");
}
function httpsUrl(raw:string|undefined) {
  if(!raw)throw new Error("Community campaign consent configuration missing");
  const url=new URL(raw);
  if(url.protocol!=="https:"||url.username||url.password||url.hash||url.search)throw new Error("Invalid Community campaign consent configuration");
  return url;
}
export function communityRecipientFooter(token:string|null) {
  if(!token||!/^[A-Za-z0-9_-]{32,128}$/.test(token))throw new Error("Community unsubscribe token missing");
  const origin=httpsUrl(process.env.GSW_COMMUNITY_WEB_ORIGIN);
  const url=new URL("/unsubscribe",origin.origin);url.searchParams.set("token",token);
  return "To stop receiving Community campaign emails, unsubscribe: "+url.toString();
}
export async function communityRecipientEligible(recipient:Recipient):Promise<boolean>{
  if(!recipient.communityUnsubscribeToken)return false;
  try {
    communityRecipientFooter(recipient.communityUnsubscribeToken);
    const endpoint=httpsUrl(process.env.GSW_COMMUNITY_UNSUBSCRIBE_CHECK_URL);
    const response=await fetch(endpoint,{method:"POST",redirect:"error",signal:AbortSignal.timeout(8000),headers:{"Content-Type":"application/json"},body:JSON.stringify({token:recipient.communityUnsubscribeToken,email:recipient.email})});
    return response.ok&&(await response.json()).eligible===true;
  }catch{return false;}
}
