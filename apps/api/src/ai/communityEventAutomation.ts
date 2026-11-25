import {createHash} from "node:crypto";
import {z} from "zod";
import {encryptMcpPayload,decryptMcpPayload,type EncryptedMcpPayload} from "../mcp/encryptedPayload.js";
import {forbidden,serviceUnavailable} from "../lib/errors.js";
export type CommunityEventGrant={eventId:string;approvalId:string;digest:string;payload:EncryptedMcpPayload};
const tokenSchema=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
function key(){
 const raw=process.env.GSW_COMMUNITY_REVIEW_KEY;
 if(!raw||!/^[a-fA-F0-9]{64}$/.test(raw))throw serviceUnavailable("Connected event encryption unavailable");
 return createHash("sha256").update(Buffer.from(raw,"hex")).update("community-event-automation-v1").digest();
}
export function sealEventGrant(input:{eventId:string;accountId:string;token:string;approvalId:string;digest:string}):CommunityEventGrant{
 const token=tokenSchema.parse(input.token);
 return {eventId:input.eventId,approvalId:input.approvalId,digest:input.digest,payload:encryptMcpPayload({approvalId:input.approvalId,argumentsDigest:input.digest,key:key(),argumentsValue:{token,eventId:input.eventId,accountId:input.accountId}})};
}
const counts=z.record(z.string().max(40),z.number().int().nonnegative().max(1000));
const bucket=z.object({counts,truncated:z.boolean(),sampleSize:z.number().int().min(0).max(1000)}).strict();
const snapshotSchema=z.object({event:z.object({id:z.string(),title:z.string().max(500),startTime:z.number(),endTime:z.number(),status:z.string().max(40),capacity:z.number().nullable()}).strict(),registrations:bucket,appointments:z.object({counts,truncated:z.boolean()}).strict(),volunteers:bucket.nullable(),sponsors:bucket.nullable(),asOf:z.number(),addressesWithheld:z.literal(true)}).strict();
export async function readCommunityEventSnapshot(grant:CommunityEventGrant,accountId:string,options:{fetcher?:typeof fetch;endpoint?:string}={}){
 const data=z.object({token:tokenSchema,eventId:z.string(),accountId:z.uuid()}).strict().parse(decryptMcpPayload({approvalId:grant.approvalId,argumentsDigest:grant.digest,key:key(),payload:grant.payload}));
 if(data.eventId!==grant.eventId||data.accountId!==accountId)throw forbidden("Event grant mismatch");
 const endpoint=options.endpoint??process.env.GSW_COMMUNITY_UNSUBSCRIBE_CHECK_URL;
 if(!endpoint)throw serviceUnavailable("Community event gateway unavailable");
 const url=new URL(endpoint);
 if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||url.pathname!=="/gsw-mail/campaign-eligibility")throw serviceUnavailable("Community event gateway unavailable");
 url.pathname="/gsw-mail/event-automation-snapshot";
 const response=await (options.fetcher??fetch)(url,{method:"POST",redirect:"error",signal:AbortSignal.timeout(15000),headers:{Authorization:"Bearer "+data.token,"Content-Type":"application/json"},body:JSON.stringify({eventId:data.eventId,accountId})});
 if(!response.ok)throw forbidden("Community event grant revoked, expired or unavailable");
 const snapshot=snapshotSchema.parse(await response.json());
 if(snapshot.event.id!==grant.eventId)throw forbidden("Community event mismatch");
 return snapshot;
}
