import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { verifyMcpBearer } from "../mcp/verifyBearer.js";
import { resolveMcpAccessProfile } from "../mcp/accessProfile.js";
import { requireAccountPermission } from "../auth/authorize.js";
import { createCommunityCampaign, getCampaign, listCampaigns, previewCampaign, getCampaignDeliveryStates } from "../ai/campaignService.js";
import { enqueueCommunityCampaign,cancelCommunityCampaign,communityCampaignJob } from "../ai/communityCampaignQueue.js";
import { COMMUNITY_AUDIENCE_TAG } from "../ai/communityCampaignPolicy.js";
import { badRequest, forbidden, unauthorized, notFound } from "../lib/errors.js";
const account=z.object({accountId:z.string().uuid()});
const draft=account.extend({id:z.string().uuid(),title:z.string().trim().min(1).max(160),subject:z.string().trim().min(1).max(998).refine(s=>!/[\r\n]/.test(s)),textBody:z.string().trim().min(1).max(60000),recipients:z.array(z.object({email:z.string().trim().email().max(254),displayName:z.string().max(200),unsubscribeToken:z.string().regex(/^[A-Za-z0-9_-]{32,128}$/)}).strict()).min(1).max(100)}).strict();
async function auth(header:string|undefined,accountId:string,scope:string){
 const identity=await verifyMcpBearer(header?.startsWith("Bearer ")?header.slice(7):"");
 if(!identity)throw unauthorized();
 if(!process.env.GSW_COMMUNITY_OAUTH_CLIENT_ID||identity.clientId!==process.env.GSW_COMMUNITY_OAUTH_CLIENT_ID||!identity.oauthScopes.has(scope))throw forbidden();
 if((await resolveMcpAccessProfile(identity.userId,identity.authUserId)).mode!=="mailbox")throw forbidden();
 const a=await requireAccountPermission(identity.userId,accountId,scope==="campaign.read"?"read":"send");
 if(a.status!=="active")throw forbidden();
 if(scope==="campaign.send"&&(!identity.oauthScopes.has("mail.send")||!identity.oauthScopes.has("templates.read")||!identity.oauthScopes.has("signatures.read")))throw forbidden();
 return identity;
}
async function owned(userId:string,accountId:string,id:string){
 const result=await getCampaign(userId,id);
 if(result.campaign.accountId!==accountId||!result.campaign.audienceTags.includes(COMMUNITY_AUDIENCE_TAG))throw notFound();
 return result;
}
export async function communityCampaignRoutes(app:FastifyInstance){
 app.addHook("onRequest",async(_req,reply)=>{reply.header("Cache-Control","no-store");});
 app.post("/integrations/community/v1/campaigns",{bodyLimit:256*1024},async(req)=>{
   const input=draft.safeParse(req.body);if(!input.success)throw badRequest("Invalid campaign");
   const identity=await auth(req.headers.authorization,input.data.accountId,"campaign.write");
   return createCommunityCampaign({...input.data,userId:identity.userId});
 });
 app.post("/integrations/community/v1/campaigns/list",async(req)=>{
   const input=account.strict().parse(req.body);const identity=await auth(req.headers.authorization,input.accountId,"campaign.read");
   const campaigns=(await listCampaigns(identity.userId,100)).filter(c=>c.accountId===input.accountId&&c.audienceTags.includes(COMMUNITY_AUDIENCE_TAG));
   return {campaigns:await Promise.all(campaigns.map(async c=>({id:c.id,title:c.title,subject:c.subject,status:c.status,recipientCount:c.recipientCount,job:await communityCampaignJob({...identity,accountId:input.accountId},c.id)})))};
 });
 app.post("/integrations/community/v1/campaigns/review",async(req)=>{
   const input=account.extend({campaignId:z.string().uuid()}).strict().parse(req.body);const identity=await auth(req.headers.authorization,input.accountId,"campaign.read");
   await owned(identity.userId,input.accountId,input.campaignId);
   return previewCampaign({...input,userId:identity.userId});
 });
 app.post("/integrations/community/v1/campaigns/launch",{config:{rateLimit:{max:2,timeWindow:"1 minute"}}},async(req)=>{
   const input=account.extend({campaignId:z.string().uuid(),reviewHash:z.string().regex(/^[a-f0-9]{64}$/),scheduledAt:z.number().int(),confirm:z.literal(true)}).strict().parse(req.body);
   const identity=await auth(req.headers.authorization,input.accountId,"campaign.send");
   await owned(identity.userId,input.accountId,input.campaignId);
   return enqueueCommunityCampaign({...identity,accountId:input.accountId},input.campaignId,input.reviewHash,input.scheduledAt);
 });
 app.post("/integrations/community/v1/campaigns/cancel",async(req)=>{
   const input=account.extend({campaignId:z.string().uuid()}).strict().parse(req.body);
   const identity=await auth(req.headers.authorization,input.accountId,"campaign.send");
   return cancelCommunityCampaign({...identity,accountId:input.accountId},input.campaignId);
 });
 app.post("/integrations/community/v1/campaigns/report",async(req)=>{
   const input=account.extend({campaignId:z.string().uuid()}).strict().parse(req.body);const identity=await auth(req.headers.authorization,input.accountId,"campaign.read");
   await owned(identity.userId,input.accountId,input.campaignId);
   return {...await getCampaignDeliveryStates({...input,userId:identity.userId}),job:await communityCampaignJob({...identity,accountId:input.accountId},input.campaignId)};
 });
}
