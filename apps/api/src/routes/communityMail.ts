import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { verifyMcpBearer } from "../mcp/verifyBearer.js";
import { resolveMcpAccessProfile } from "../mcp/accessProfile.js";
import { requireAccountPermission } from "../auth/authorize.js";
import { applySignature, resolveComposePreferences } from "../services/mailService.js";
import { buildOutgoingMessageForUser } from "../mail/messageBuilder.js";
import { renderedMessageDigest, communitySendDigest, signCommunityReview, verifyCommunityReview } from "../mail/communityReview.js";
import { submitSend } from "../outbound/sendFlow.js";
import { badRequest, conflict, forbidden, serviceUnavailable, unauthorized } from "../lib/errors.js";

const compose = z.object({
  accountId:z.string().uuid(),
  to:z.string().trim().email().max(254),
  subject:z.string().trim().max(998).refine(s=>!/[\r\n]/.test(s)),
  body:z.string().trim().min(1).max(60000),
}).strict();
const sendInput=compose.extend({reviewToken:z.string().min(1).max(2048),confirm:z.literal(true)}).strict();
type Compose=z.infer<typeof compose>;

function reviewKey() {
  const raw=process.env.GSW_COMMUNITY_REVIEW_KEY;
  if(process.env.GSW_COMMUNITY_SEND_ENABLED!=="true"||!raw||!/^[a-fA-F0-9]{64}$/.test(raw))throw serviceUnavailable("Connected sending is not enabled");
  return Buffer.from(raw,"hex");
}
async function authorize(header:string|undefined,accountId:string) {
  const token=header?.startsWith("Bearer ")?header.slice(7):"";
  const identity=await verifyMcpBearer(token);
  if(!identity)throw unauthorized();
  if(!process.env.GSW_COMMUNITY_OAUTH_CLIENT_ID||identity.clientId!==process.env.GSW_COMMUNITY_OAUTH_CLIENT_ID||!identity.oauthScopes.has("mail.send")||!identity.oauthScopes.has("templates.read")||!identity.oauthScopes.has("signatures.read"))throw forbidden();
  if((await resolveMcpAccessProfile(identity.userId,identity.authUserId)).mode!=="mailbox")throw forbidden();
  const account=await requireAccountPermission(identity.userId,accountId,"send");
  if(account.status!=="active")throw forbidden();
  return {identity,account};
}
async function prepare(header:string|undefined,input:Compose) {
  const {identity,account}=await authorize(header,input.accountId);
  const preferences=await resolveComposePreferences(identity.userId,account.address,"new");
  const body=applySignature({textBody:input.body,richText:preferences.richText,signature:preferences.signature});
  const rendered=await buildOutgoingMessageForUser({userId:identity.userId,bodyText:body.textBody,bodyHtml:body.htmlBody,preserveTextBody:true,templateKey:preferences.templateKey,senderEmail:account.address,senderName:account.displayName??undefined});
  const renderDigest=renderedMessageDigest(rendered);
  const digest=communitySendDigest({userId:identity.userId,clientId:identity.clientId,accountId:account.id,senderAddress:account.address,senderName:account.displayName,to:input.to,subject:input.subject,renderDigest});
  return {identity,account,body,rendered,digest,renderDigest,signatureApplied:Boolean(preferences.signature)};
}
export async function communityMailRoutes(app:FastifyInstance) {
  app.post("/integrations/community/v1/compose/review",{bodyLimit:256*1024,config:{rateLimit:{max:12,timeWindow:"1 minute"}}},async(req,reply)=>{
    reply.header("Cache-Control","no-store");
    const key=reviewKey(),parsed=compose.safeParse(req.body);
    if(!parsed.success)throw badRequest("Invalid email");
    const input=parsed.data,prepared=await prepare(req.headers.authorization,input);
    const expiresAt=Date.now()+10*60_000;
    return {from:prepared.account.address,fromName:prepared.account.displayName,to:input.to,subject:input.subject,text:prepared.rendered.text,templateKey:prepared.rendered.templateKey,signatureApplied:prepared.signatureApplied,expiresAt,reviewToken:signCommunityReview({id:randomUUID(),digest:prepared.digest,expiresAt},key)};
  });
  app.post("/integrations/community/v1/compose/send",{bodyLimit:256*1024,config:{rateLimit:{max:6,timeWindow:"1 minute"}}},async(req,reply)=>{
    reply.header("Cache-Control","no-store");
    const key=reviewKey(),parsed=sendInput.safeParse(req.body);
    if(!parsed.success)throw badRequest("Explicit email review and confirmation are required");
    const {reviewToken,confirm:_confirm,...input}=parsed.data;
    const prepared=await prepare(req.headers.authorization,input);
    const review=verifyCommunityReview(reviewToken,key,prepared.digest);
    if(!review)throw conflict("Review expired or content changed. Review again before sending.");
    // A reviewed request ID is immutable and scoped to the authorized account.
    // Native outbound reservation deduplicates concurrent/repeated submissions.
    const result=await submitSend({userId:prepared.identity.userId,authUserId:prepared.identity.authUserId,headers:{},account:prepared.account,to:[input.to],subject:input.subject,textBody:prepared.body.textBody,htmlBody:prepared.body.htmlBody,preserveTextBody:true,templateKey:prepared.rendered.templateKey,expectedRenderDigest:prepared.renderDigest,clientRequestId:"community:"+review.id,mode:"new"});
    reply.code(202);
    return {sendId:result.sendId,status:result.transportStatus,messageId:result.messageId,threadId:result.threadId,idempotentReplay:result.idempotentReplay===true};
  });
}
