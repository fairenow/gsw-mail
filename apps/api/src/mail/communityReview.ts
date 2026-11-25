import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const renderedMessageDigest = (rendered:{html:string;text:string;templateKey:string}):string =>
  createHash("sha256").update(JSON.stringify([rendered.templateKey,rendered.text,rendered.html])).digest("hex");
export const communitySendDigest = (input:{userId:string;clientId:string;accountId:string;senderAddress:string;senderName:string|null;to:string;subject:string;renderDigest:string;threading?:string|undefined}):string =>
  createHash("sha256").update(JSON.stringify([input.userId,input.clientId,input.accountId,input.senderAddress,input.senderName,input.to,input.subject,input.renderDigest,input.threading??null])).digest("hex");

const claims = z.object({id:z.string().uuid(),digest:z.string().regex(/^[0-9a-f]{64}$/),expiresAt:z.number().int()}).strict();
type ReviewClaims=z.infer<typeof claims>;
const mac = (payload:string,key:Buffer)=>createHmac("sha256",key).update(payload).digest();
export function signCommunityReview(input:ReviewClaims,key:Buffer):string {
  const payload=Buffer.from(JSON.stringify(claims.parse(input))).toString("base64url");
  return payload+"."+mac(payload,key).toString("base64url");
}
export function verifyCommunityReview(token:string,key:Buffer,expectedDigest:string,now=Date.now()):ReviewClaims|null {
  if(token.length>2048)return null;
  const parts=token.split(".");
  if(parts.length!==2)return null;
  const payload=parts[0]!, encoded=parts[1]!;
  if(!/^[A-Za-z0-9_-]+$/.test(payload)||!/^[A-Za-z0-9_-]{43}$/.test(encoded))return null;
  const actual=Buffer.from(encoded,"base64url"),expected=mac(payload,key);
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return null;
  try {
    const value=claims.parse(JSON.parse(Buffer.from(payload,"base64url").toString("utf8")));
    return value.digest===expectedDigest&&value.expiresAt>now?value:null;
  } catch {return null;}
}
