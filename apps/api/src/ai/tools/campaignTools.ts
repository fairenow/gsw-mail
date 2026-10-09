import { z } from "zod";
import { createCampaign, getCampaign, launchCampaign, listCampaigns, previewCampaign, replaceCampaignAudience, updateDraftCampaign, getCampaignDeliveryStates } from "../campaignService.js";
import type { AgentExecutionContext, AgentToolDefinition, AgentToolResult } from "./types.js";

const success = <T>(ctx: AgentExecutionContext, toolCallId: string, startedAt: string, data: T): AgentToolResult<T> => ({
  ok: true,
  toolCallId,
  data,
  audit: { userId: ctx.userId, accountId: ctx.accountId, startedAt, completedAt: new Date().toISOString() },
});

const failure = (ctx: AgentExecutionContext, toolCallId: string, startedAt: string, error: unknown): AgentToolResult => ({
  ok: false,
  toolCallId,
  error: { code: "tool_failed", message: error instanceof Error ? error.message : String(error), retryable: false },
  audit: { userId: ctx.userId, accountId: ctx.accountId, startedAt, completedAt: new Date().toISOString() },
});

export const campaignCreateTool: AgentToolDefinition = {
  name: "campaign.create",
  description: [
    "Create a real draft campaign for contacts matching ALL supplied contact tags.",
    "Use contact tags as the audience segmentation primitive.",
    "Creating a campaign does not send it. The body supports {{firstName}} and {{email}} personalization tokens.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string" },
      subject: { type: "string" },
      textBody: { type: "string" },
      htmlBody: { type: "string" },
      audienceTags: { type: "array", items: { type: "string" }, minItems: 1 },
    },
    required: ["title", "subject", "audienceTags"],
    additionalProperties: false,
  },
  requiredScopes: ["contacts.read", "campaign.write"],
  risk: "reversible_write",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = z.object({
        title: z.string().trim().min(1).max(160),
        subject: z.string().trim().min(1).max(998),
        textBody: z.string().max(200_000).optional(),
        htmlBody: z.string().max(500_000).optional(),
        audienceTags: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
      }).parse(rawInput);
      const campaign = await createCampaign({
        userId: ctx.userId,
        accountId: ctx.accountId,
        ...input,
      });
      return success(ctx, toolCallId, startedAt, {
        id: campaign.id,
        reviewUrl: `/campaigns/${campaign.id}`,
        title: campaign.title,
        subject: campaign.subject,
        audienceTags: campaign.audienceTags,
        recipientCount: campaign.recipientCount,
        status: campaign.status,
      });
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const campaignListTool: AgentToolDefinition = {
  name: "campaign.list",
  description: "List recent GSW Mail campaigns and their audience tags, recipient count, and launch status.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  requiredScopes: ["campaign.read"],
  risk: "read",
  async execute(ctx, _rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const campaigns = await listCampaigns(ctx.userId);
      return success(ctx, toolCallId, startedAt, {
        campaigns: campaigns.map((campaign) => ({
          id: campaign.id,
          title: campaign.title,
          subject: campaign.subject,
          audienceTags: campaign.audienceTags,
          recipientCount: campaign.recipientCount,
          status: campaign.status,
          launchedAt: campaign.launchedAt?.toISOString() ?? null,
        })),
      });
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const campaignReadTool: AgentToolDefinition = {
  name: "campaign.read",
  description: "Read one prepared campaign, including its audience and recipient delivery state.",
  inputSchema: {
    type: "object",
    properties: { campaignId: { type: "string" } },
    required: ["campaignId"],
    additionalProperties: false,
  },
  requiredScopes: ["campaign.read"],
  risk: "read",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = z.object({ campaignId: z.string().uuid() }).parse(rawInput);
      const result = await getCampaign(ctx.userId, input.campaignId);
      return success(ctx, toolCallId, startedAt, {
        campaign: result.campaign,
        recipients: result.recipients.map((recipient) => ({
          email: recipient.email,
          displayName: recipient.displayName,
          status: recipient.status,
          errorMessage: recipient.errorMessage,
        })),
      });
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};

export const campaignLaunchTool: AgentToolDefinition = {
  name: "campaign.launch",
  description: "Launch a prepared campaign to its tagged contact audience. This queues one individual GSW Mail message per contact and requires explicit confirmation.",
  inputSchema: {
    type: "object",
    properties: { campaignId: { type: "string" } },
    required: ["campaignId"],
    additionalProperties: false,
  },
  requiredScopes: ["campaign.send"],
  risk: "external",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const input = z.object({ campaignId: z.string().uuid() }).parse(rawInput);
      const result = await launchCampaign(ctx, input.campaignId);
      return success(ctx, toolCallId, startedAt, {
        campaignId: input.campaignId,
        sent: result.sent,
        failed: result.failed,
        status: result.campaign.status,
      });
    } catch (error) {
      return failure(ctx, toolCallId, startedAt, error);
    }
  },
};


export const campaignReportTool: AgentToolDefinition = {
  name: "campaign.report",
  description: "Summarize persisted recipient queue results for an owned campaign, highlight failed recipients and provide suggested follow-up next steps. Queued does NOT mean delivered, opened or read.",
  inputSchema: { type: "object", properties: { campaignId: { type: "string" } }, required: ["campaignId"], additionalProperties: false },
  requiredScopes: ["campaign.read"], risk: "read",
  async execute(ctx, rawInput, toolCallId) {
    const startedAt = new Date().toISOString();
    try {
      const { campaignId } = z.object({ campaignId: z.string().uuid() }).parse(rawInput);
      const details = await getCampaignDeliveryStates({userId:ctx.userId,accountId:ctx.accountId,campaignId});
      const {campaign}=details;
      const recipients=details.recipients;
      const statuses=details.counts;
      return success(ctx, toolCallId, startedAt, {
        campaign: { id: campaign.id, title: campaign.title, status: campaign.status, recipientCount: campaign.recipientCount },
        counts: statuses,
        // Deliberately do not infer delivery or engagement from queued send state.
        deliveryConfirmed: recipients.some(r=>r.deliveredAt!==null), openTrackingAvailable: false,
        deliveryTrackingSource: details.deliveryTrackingSource,
        recipientStatuses: recipients,
        failedRecipients: recipients.filter(r=>r.queueStatus==="failed" || r.deliveryStatus==="bounced" || r.deliveryStatus==="complained" || r.deliveryStatus==="partial_failure").slice(0,50).map(r=>({ email: r.email, status: r.deliveryStatus??r.queueStatus })),
        suggestedNextSteps: [
          "Review failed recipient addresses before considering a targeted retry.",
          "Check mail delivery status independently; queued is not proof of delivery.",
          "Prepare follow-up drafts only after reviewing outcomes and timing.",
        ],
      });
    } catch(error) { return failure(ctx, toolCallId, startedAt, error); }
  },
};

export const campaignAudienceEditTool: AgentToolDefinition = {
  name: "campaign.audience.edit",
  description: "Replace the draft campaign audience with a reviewed list of owned contact IDs. This does not send mail. Use campaign.preview before launch.",
  inputSchema: { type:"object", properties:{campaignId:{type:"string"},contactIds:{type:"array",items:{type:"string"},minItems:1,maxItems:100}},required:["campaignId","contactIds"],additionalProperties:false },
  requiredScopes:["contacts.read","campaign.write"],risk:"reversible_write",
  async execute(ctx,rawInput,toolCallId){
    const startedAt=new Date().toISOString();
    try{
      const input=z.object({campaignId:z.string().uuid(),contactIds:z.array(z.string().uuid()).min(1).max(100)}).parse(rawInput);
      return success(ctx,toolCallId,startedAt,await replaceCampaignAudience({userId:ctx.userId,accountId:ctx.accountId,...input}));
    } catch(error){return failure(ctx,toolCallId,startedAt,error);}
  },
};
export const campaignDraftEditTool: AgentToolDefinition = {
  name:"campaign.draft.edit",
  description:"Edit subject and text content of a draft campaign; never launches it. Review campaign.preview before sending.",
  inputSchema:{type:"object",properties:{campaignId:{type:"string"},subject:{type:"string"},textBody:{type:"string"},htmlBody:{type:"string"}},required:["campaignId"],additionalProperties:false},
  requiredScopes:["campaign.write"],risk:"reversible_write",
  async execute(ctx,rawInput,toolCallId){
    const startedAt=new Date().toISOString();
    try{
      const input=z.object({campaignId:z.string().uuid(),subject:z.string().trim().min(1).max(998).optional(),textBody:z.string().max(200000).optional(),htmlBody:z.string().max(500000).optional()}).refine(x=>x.subject!==undefined||x.textBody!==undefined||x.htmlBody!==undefined).parse(rawInput);
      const result=await updateDraftCampaign({userId:ctx.userId,accountId:ctx.accountId,...input});
      return success(ctx,toolCallId,startedAt,{id:result.id,status:result.status,subject:result.subject,recipientCount:result.recipientCount});
    }catch(error){return failure(ctx,toolCallId,startedAt,error);}
  },
};
export const campaignAttachmentsTool: AgentToolDefinition = {
  name:"campaign.attachments.set",
  description:"Select up to five existing owned GSW Files assets for a draft campaign. An empty list removes attachments. Changes require draft status; review the campaign preview before launch.",
  inputSchema:{type:"object",properties:{campaignId:{type:"string"},assetIds:{type:"array",items:{type:"string"},maxItems:5}},required:["campaignId","assetIds"],additionalProperties:false},
  requiredScopes:["campaign.write","files.read"],risk:"reversible_write",
  async execute(ctx,rawInput,toolCallId){
    const startedAt=new Date().toISOString();
    try{
      const {campaignId,assetIds}=z.object({campaignId:z.string().uuid(),assetIds:z.array(z.string().uuid()).max(5)}).parse(rawInput);
      const campaign=await updateDraftCampaign({userId:ctx.userId,accountId:ctx.accountId,campaignId,attachmentAssetIds:assetIds});
      return success(ctx,toolCallId,startedAt,{campaignId:campaign.id,attachmentAssetIds:campaign.attachmentAssetIds,recipientCount:campaign.recipientCount});
    }catch(error){return failure(ctx,toolCallId,startedAt,error);}
  },
};
export const campaignPreviewTool: AgentToolDefinition = {
  name:"campaign.preview",
  description:"Read the exact saved recipient snapshot and personalized subject/text for a draft campaign prior to approval. Read-only. Does not imply delivery.",
  inputSchema:{type:"object",properties:{campaignId:{type:"string"}},required:["campaignId"],additionalProperties:false},
  requiredScopes:["campaign.read"],risk:"read",
  async execute(ctx,rawInput,toolCallId){
    const startedAt=new Date().toISOString();
    try{
      const {campaignId}=z.object({campaignId:z.string().uuid()}).parse(rawInput);
      return success(ctx,toolCallId,startedAt,await previewCampaign({userId:ctx.userId,accountId:ctx.accountId,campaignId}));
    }catch(error){return failure(ctx,toolCallId,startedAt,error);}
  },
};
export const campaignTools: AgentToolDefinition[] = [
  campaignAudienceEditTool,
  campaignDraftEditTool,
  campaignAttachmentsTool,
  campaignPreviewTool,
  campaignReportTool,
  campaignCreateTool,
  campaignListTool,
  campaignReadTool,
  campaignLaunchTool,
];
