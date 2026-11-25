import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { verifyMcpBearer } from "../mcp/verifyBearer.js";
import { resolveMcpAccessProfile } from "../mcp/accessProfile.js";
import { requireAccountPermission } from "../auth/authorize.js";
import { applySignature, resolveComposePreferences, createMailService } from "../services/mailService.js";
import { buildOutgoingMessageForUser } from "../mail/messageBuilder.js";
import { renderedMessageDigest, communitySendDigest, signCommunityReview, verifyCommunityReview } from "../mail/communityReview.js";
import { submitSend } from "../outbound/sendFlow.js";
import { reserveAiIdempotency,completeAiIdempotency,failAiIdempotency } from "../ai/agentState.js";
import { db } from "../db/client.js";
import { oauthConsent,oauthRefreshToken,oauthAccessToken,auditEvents } from "../db/schema.js";
import { and,eq } from "drizzle-orm";
import { badRequest, conflict, forbidden, serviceUnavailable, unauthorized } from "../lib/errors.js";

const compose = z.object({
  accountId:z.string().uuid(),
  to:z.string().trim().email().max(254),
  subject:z.string().trim().max(998).refine(s=>!/[\r\n]/.test(s)),
  body:z.string().trim().min(1).max(60000),
  replyMessageId:z.string().min(1).max(1000).optional(),
}).strict();
const sendInput=compose.extend({reviewToken:z.string().min(1).max(2048),confirm:z.literal(true)}).strict();
type Compose=z.infer<typeof compose>;

function reviewKey() {
  const raw=process.env.GSW_COMMUNITY_REVIEW_KEY;
  if(!raw||!/^[a-fA-F0-9]{64}$/.test(raw))throw serviceUnavailable("Connected sending configuration missing");
  return Buffer.from(raw,"hex");
}
async function authorize(header:string|undefined,accountId:string,scope="mail.send") {
  const token=header?.startsWith("Bearer ")?header.slice(7):"";
  const identity=await verifyMcpBearer(token);
  if(!identity)throw unauthorized();
  if(!process.env.GSW_COMMUNITY_OAUTH_CLIENT_ID||identity.clientId!==process.env.GSW_COMMUNITY_OAUTH_CLIENT_ID||!identity.oauthScopes.has(scope)||!identity.oauthScopes.has("templates.read")||!identity.oauthScopes.has("signatures.read"))throw forbidden();
  if((await resolveMcpAccessProfile(identity.userId,identity.authUserId)).mode!=="mailbox")throw forbidden();
  const account=await requireAccountPermission(identity.userId,accountId,"send");
  if(account.status!=="active")throw forbidden();
  return {identity,account};
}
async function prepare(header:string|undefined,input:Compose,scope="mail.send") {
  const {identity,account}=await authorize(header,input.accountId,scope);
  const mail=createMailService({userId:identity.userId,authUserId:identity.authUserId,headers:{}});
  let to=input.to,subject=input.subject,inReplyTo:string|undefined,references:string|undefined;
  const mode=input.replyMessageId?"reply":"new";
  if(input.replyMessageId){
    if(!identity.oauthScopes.has("mail.read"))throw forbidden();
    const source=await mail.readMessage(account.id,input.replyMessageId,false);
    const headerValue=(key:string)=>Object.entries(source.headers).find(([name])=>name.toLowerCase()===key)?.[1]?.trim();
    const sourceId=headerValue("message-id");
    if(!sourceId||!/^<[^<>\r\n]+>$/.test(sourceId)||!source.from?.email||/draft/i.test(source.mailbox))throw badRequest("Original message cannot be replied to");
    const replyTo=headerValue("reply-to");
    // A complex Reply-To address list needs a full native reply composer.
    if(replyTo&&!z.string().email().safeParse(replyTo).success)throw badRequest("Open this message in native GSW Mail to reply to its address list");
    to=replyTo??source.from.email;
    if(!z.string().email().safeParse(to).success||to.toLowerCase()===account.address.toLowerCase())throw badRequest("Invalid reply recipient");
    subject=/^re\s*:/i.test(source.subject)?source.subject:"Re: "+source.subject;
    if(subject.length>998||/[\r\n]/.test(subject))throw badRequest("Invalid reply subject");
    inReplyTo=sourceId;references=[headerValue("references"),sourceId].filter(Boolean).join(" ").slice(-8000);
  }
  const preferences=await resolveComposePreferences(identity.userId,account.address,mode);
  const body=applySignature({textBody:input.body,richText:preferences.richText,signature:preferences.signature});
  const rendered=await buildOutgoingMessageForUser({userId:identity.userId,bodyText:body.textBody,bodyHtml:body.htmlBody,preserveTextBody:true,templateKey:preferences.templateKey,senderEmail:account.address,senderName:account.displayName??undefined});
  const renderDigest=renderedMessageDigest(rendered);
  const digest=communitySendDigest({userId:identity.userId,clientId:identity.clientId,accountId:account.id,senderAddress:account.address,senderName:account.displayName,to,subject,renderDigest,threading:JSON.stringify([input.replyMessageId??null,inReplyTo??null,references??null])});
  return {identity,account,body,rendered,digest,renderDigest,to,subject,mode,inReplyTo,references,signatureApplied:Boolean(preferences.signature)};
}
export async function communityMailRoutes(app:FastifyInstance) {
  app.post("/integrations/community/v1/compose/review",{bodyLimit:256*1024,config:{rateLimit:{max:12,timeWindow:"1 minute"}}},async(req,reply)=>{
    reply.header("Cache-Control","no-store");
    const key=reviewKey(),parsed=compose.safeParse(req.body);
    if(!parsed.success)throw badRequest("Invalid email");
    const input=parsed.data,prepared=await prepare(req.headers.authorization,input);
    const expiresAt=Date.now()+10*60_000;
    return {from:prepared.account.address,fromName:prepared.account.displayName,to:prepared.to,subject:prepared.subject,text:prepared.rendered.text,templateKey:prepared.rendered.templateKey,signatureApplied:prepared.signatureApplied,expiresAt,reviewToken:signCommunityReview({id:randomUUID(),digest:prepared.digest,expiresAt},key)};
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
    const result=await submitSend({userId:prepared.identity.userId,authUserId:prepared.identity.authUserId,headers:{},account:prepared.account,to:[prepared.to],subject:prepared.subject,textBody:prepared.body.textBody,htmlBody:prepared.body.htmlBody,preserveTextBody:true,templateKey:prepared.rendered.templateKey,expectedRenderDigest:prepared.renderDigest,clientRequestId:"community:"+review.id,mode:prepared.mode,inReplyTo:prepared.inReplyTo,references:prepared.references});
    reply.code(202);
    return {sendId:result.sendId,status:result.transportStatus,messageId:result.messageId,threadId:result.threadId,idempotentReplay:result.idempotentReplay===true};
  });
  app.post("/integrations/community/v1/compose/draft",{bodyLimit:256*1024},async(req,reply)=>{
    reply.header("Cache-Control","no-store");
    const parsed=sendInput.safeParse(req.body);if(!parsed.success)throw badRequest("Review and confirmation required");
    const {reviewToken,confirm:_confirm,...input}=parsed.data;
    const prepared=await prepare(req.headers.authorization,input,"mail.write");
    const review=verifyCommunityReview(reviewToken,reviewKey(),prepared.digest);
    if(!review)throw conflict("Review expired or changed");
    const key="community-manual-draft:"+review.id;
    const reservation=await reserveAiIdempotency({key,userId:prepared.identity.userId,accountId:prepared.account.id,toolCallId:null,toolName:"mail.create_draft",fingerprint:review.digest});
    if(reservation.reused){
      if(reservation.reservation.userId===prepared.identity.userId&&reservation.reservation.accountId===prepared.account.id&&reservation.reservation.status==="completed")return {saved:true,replay:true};
      throw conflict("Draft already attempted; check Drafts");
    }
    try{
      await createMailService({userId:prepared.identity.userId,authUserId:prepared.identity.authUserId,headers:{}}).createDraft(prepared.account.id,{to:[prepared.to],subject:prepared.subject,textBody:input.body,mode:prepared.mode,inReplyTo:prepared.inReplyTo,references:prepared.references});
      await completeAiIdempotency(key,{saved:true});return {saved:true,replay:false};
    }catch{await failAiIdempotency(key,new Error("Draft outcome unconfirmed"));throw serviceUnavailable("Check Drafts before retrying");}
  });
  app.post("/integrations/community/v1/disconnect",async(req,reply)=>{
    reply.header("Cache-Control","no-store");
    const identity=await verifyMcpBearer(req.headers.authorization?.startsWith("Bearer ")?req.headers.authorization.slice(7):"");
    if(!identity)throw unauthorized();
    if(!process.env.GSW_COMMUNITY_OAUTH_CLIENT_ID||identity.clientId!==process.env.GSW_COMMUNITY_OAUTH_CLIENT_ID)throw forbidden();
    await db.transaction(async tx=>{
      await tx.delete(oauthAccessToken).where(and(eq(oauthAccessToken.userId,identity.authUserId),eq(oauthAccessToken.clientId,identity.clientId)));
      await tx.delete(oauthRefreshToken).where(and(eq(oauthRefreshToken.userId,identity.authUserId),eq(oauthRefreshToken.clientId,identity.clientId)));
      await tx.delete(oauthConsent).where(and(eq(oauthConsent.userId,identity.authUserId),eq(oauthConsent.clientId,identity.clientId)));
      await tx.insert(auditEvents).values({actorUserId:identity.userId,action:"oauth.connection.disconnected",resourceType:"oauth_connection",resourceId:identity.clientId,metadata:{source:"community"}});
    });
    return {disconnected:true};
  });
}
