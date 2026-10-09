import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  aiCampaignRecipients,
  aiCampaigns,
  contactEmails,
  contactTags,
  contacts,
  outboundMessages,
} from "../db/schema.js";
import { badRequest, notFound } from "../lib/errors.js";
import { createMailService } from "../services/mailService.js";
import type { AgentExecutionContext } from "./tools/types.js";

const normalizeTags = (tags: string[]) => [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];

export async function createCampaign(input: {
  userId: string;
  accountId: string;
  title: string;
  subject: string;
  textBody?: string | undefined;
  htmlBody?: string | undefined;
  audienceTags: string[];
}) {
  const audienceTags = normalizeTags(input.audienceTags);
  if (!audienceTags.length) throw badRequest("campaign audience needs at least one contact tag");

  const tagged = await db.select({
    contactId: contactTags.contactId,
    normalizedTag: contactTags.normalizedTag,
  }).from(contactTags)
    .innerJoin(contacts, eq(contactTags.contactId, contacts.id))
    .where(and(eq(contacts.ownerUserId, input.userId), inArray(contactTags.normalizedTag, audienceTags)));

  const byContact = new Map<string, Set<string>>();
  for (const row of tagged) {
    const tags = byContact.get(row.contactId) ?? new Set<string>();
    tags.add(row.normalizedTag);
    byContact.set(row.contactId, tags);
  }
  const contactIds = [...byContact.entries()]
    .filter(([, tags]) => audienceTags.every((tag) => tags.has(tag)))
    .map(([contactId]) => contactId);

  if (!contactIds.length) throw badRequest(`no contacts match all tags: ${audienceTags.join(", ")}`);

  const [contactRows, emailRows] = await Promise.all([
    db.select({
      id: contacts.id,
      displayName: contacts.displayName,
      firstName: contacts.firstName,
    }).from(contacts).where(and(eq(contacts.ownerUserId, input.userId), inArray(contacts.id, contactIds))),
    db.select().from(contactEmails).where(inArray(contactEmails.contactId, contactIds)),
  ]);

  const recipients = contactRows.flatMap((contact) => {
    const emails = emailRows.filter((email) => email.contactId === contact.id);
    const primary = emails.find((email) => email.isPrimary) ?? emails[0];
    if (!primary) return [];
    return [{
      contactId: contact.id,
      email: primary.normalizedEmail || primary.email.toLowerCase(),
      displayName: contact.displayName,
      firstName: contact.firstName,
    }];
  });

  if (!recipients.length) throw badRequest("matching contacts do not have email addresses");
  if (recipients.length > 100) throw badRequest("campaign audiences are currently limited to 100 recipients per launch");

  return db.transaction(async (tx) => {
    const [campaign] = await tx.insert(aiCampaigns).values({
      userId: input.userId,
      accountId: input.accountId,
      title: input.title.trim().slice(0, 160),
      subject: input.subject.trim().slice(0, 998),
      textBody: input.textBody,
      htmlBody: input.htmlBody,
      audienceTags,
      recipientCount: recipients.length,
      status: "draft",
    }).returning();
    if (!campaign) throw new Error("failed to create campaign");
    await tx.insert(aiCampaignRecipients).values(recipients.map((recipient) => ({ campaignId: campaign.id, ...recipient })));
    return campaign;
  });
}

export async function listCampaigns(userId: string, limit = 50) {
  return db.select().from(aiCampaigns)
    .where(eq(aiCampaigns.userId, userId))
    .orderBy(desc(aiCampaigns.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
}

export async function getCampaign(userId: string, id: string) {
  const [campaign] = await db.select().from(aiCampaigns).where(and(
    eq(aiCampaigns.id, id),
    eq(aiCampaigns.userId, userId),
  )).limit(1);
  if (!campaign) throw notFound("campaign not found");
  const recipients = await db.select().from(aiCampaignRecipients)
    .where(eq(aiCampaignRecipients.campaignId, id))
    .orderBy(asc(aiCampaignRecipients.createdAt));
  return { campaign, recipients };
}

/**
 * Atomically replace a draft campaign's audience using owned contact IDs.
 * The saved recipient snapshot is the reviewed audience; tag membership cannot
 * silently change it after approval. Never mutate launched campaigns.
 */
export async function replaceCampaignAudience(input: {
  userId: string; accountId: string; campaignId: string; contactIds: string[];
}) {
  const unique = [...new Set(input.contactIds)];
  if (!unique.length || unique.length > 100) throw badRequest("select between 1 and 100 contacts");
  return db.transaction(async (tx) => {
    const [campaign] = await tx.select().from(aiCampaigns).where(and(eq(aiCampaigns.id,input.campaignId), eq(aiCampaigns.userId,input.userId), eq(aiCampaigns.accountId,input.accountId))).for("update");
    if (!campaign) throw notFound("campaign not found");
    if (campaign.status !== "draft") throw badRequest("only draft campaign audiences can be edited");
    const selected = await tx.select({ id: contacts.id, displayName: contacts.displayName, firstName: contacts.firstName }).from(contacts)
      .where(and(eq(contacts.ownerUserId,input.userId),inArray(contacts.id,unique)));
    if (selected.length !== unique.length) throw badRequest("some contacts are not available");
    const emails = await tx.select().from(contactEmails).where(inArray(contactEmails.contactId,unique));
    const recipients = selected.map(contact=>{
      const options = emails.filter(email=>email.contactId===contact.id);
      const preferred = options.find(email=>email.isPrimary) ?? options[0];
      if (!preferred) throw badRequest("every selected contact needs an email");
      return {
        campaignId: input.campaignId, contactId: contact.id,
        email: preferred.normalizedEmail || preferred.email.toLowerCase(),
        displayName: contact.displayName, firstName: contact.firstName,
      };
    });
    if (new Set(recipients.map(r=>r.email)).size !== recipients.length) throw badRequest("selected contacts have duplicate email addresses");
    await tx.delete(aiCampaignRecipients).where(eq(aiCampaignRecipients.campaignId,input.campaignId));
    await tx.insert(aiCampaignRecipients).values(recipients);
    await tx.update(aiCampaigns).set({ recipientCount: recipients.length, updatedAt: new Date() }).where(eq(aiCampaigns.id,input.campaignId));
    return { campaignId: input.campaignId, recipientCount: recipients.length, recipients: recipients.map(r=>({ contactId:r.contactId,email:r.email,displayName:r.displayName })) };
  });
}

export async function updateDraftCampaign(input: {
  userId: string; accountId: string; campaignId: string;
  subject?: string | undefined; textBody?: string | undefined; htmlBody?: string | undefined;
}) {
  return db.transaction(async tx=>{
    const [campaign] = await tx.select().from(aiCampaigns).where(and(eq(aiCampaigns.id,input.campaignId),eq(aiCampaigns.userId,input.userId),eq(aiCampaigns.accountId,input.accountId))).for("update");
    if (!campaign) throw notFound("campaign not found");
    if (campaign.status !== "draft") throw badRequest("only draft campaigns can be edited");
    const [saved] = await tx.update(aiCampaigns).set({
      ...(input.subject !== undefined ? { subject:input.subject } : {}),
      ...(input.textBody !== undefined ? { textBody:input.textBody } : {}),
      ...(input.htmlBody !== undefined ? { htmlBody:input.htmlBody } : {}),
      updatedAt:new Date(),
    }).where(eq(aiCampaigns.id,input.campaignId)).returning();
    return saved!;
  });
}

export async function previewCampaign(input: {userId:string; accountId:string; campaignId:string}) {
  const {campaign,recipients} = await getCampaign(input.userId,input.campaignId);
  if (campaign.accountId !== input.accountId) throw notFound("campaign not found");
  return { campaign: {id:campaign.id,title:campaign.title,subject:campaign.subject,status:campaign.status,recipientCount:recipients.length},
    recipients:recipients.slice(0,100).map(recipient=>({
      id:recipient.id, contactId:recipient.contactId,email:recipient.email,displayName:recipient.displayName,
      subject:personalize(campaign.subject,recipient),
      textBody:personalize(campaign.textBody,recipient),
      // Do not render untrusted HTML previews without sanitization.
    }))
  };
}

export async function getCampaignDeliveryStates(input: {userId:string;accountId:string;campaignId:string}) {
  const {campaign,recipients}=await getCampaign(input.userId,input.campaignId);
  if(campaign.accountId!==input.accountId) throw notFound("campaign not found");
  const ids=recipients.map(r=>r.sendId).filter((id): id is string=>Boolean(id));
  const records=ids.length?await db.select({
    id:outboundMessages.id,deliveryStatus:outboundMessages.deliveryStatus,
    transportStatus:outboundMessages.transportStatus,deliveredAt:outboundMessages.deliveredAt,
    acceptedAt:outboundMessages.acceptedAt, failureCode:outboundMessages.failureCode,
  }).from(outboundMessages).where(and(eq(outboundMessages.accountId,input.accountId),inArray(outboundMessages.id,ids))):[];
  const byId=new Map(records.map(record=>[record.id,record]));
  const rows=recipients.map(recipient=>{
    const outbound=recipient.sendId?byId.get(recipient.sendId):undefined;
    return {email:recipient.email,queueStatus:recipient.status,
      deliveryStatus:outbound?.deliveryStatus??null,transportStatus:outbound?.transportStatus??null,
      acceptedAt:outbound?.acceptedAt?.toISOString()??null,deliveredAt:outbound?.deliveredAt?.toISOString()??null,
      failureCode:outbound?.failureCode??null};
  });
  const counts:Record<string,number>={};
  for(const row of rows){const state=row.deliveryStatus??row.queueStatus;counts[state]=(counts[state]??0)+1;}
  return {campaign:{id:campaign.id,title:campaign.title,status:campaign.status,recipientCount:recipients.length},counts,
    recipients:rows.slice(0,100),deliveryTrackingSource:"outbound_messages",openTrackingAvailable:false};
}

const personalize = (value: string | null, recipient: { firstName: string | null; displayName: string | null; email: string }) => {
  if (!value) return undefined;
  const firstName = recipient.firstName?.trim()
    || recipient.displayName?.trim().split(/\s+/)[0]
    || recipient.email.split("@")[0]
    || "";
  return value
    .replaceAll("{{firstName}}", firstName)
    .replaceAll("{{email}}", recipient.email);
};

async function runInBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let offset = 0; offset < items.length; offset += size) {
    await Promise.all(items.slice(offset, offset + size).map(fn));
  }
}

export async function launchCampaign(ctx: AgentExecutionContext, campaignId: string) {
  const { campaign, recipients: initialRecipients } = await getCampaign(ctx.userId, campaignId);
  if (campaign.accountId !== ctx.accountId) throw badRequest("campaign belongs to a different mailbox");
  if (campaign.status === "launched") return { campaign, sent: initialRecipients.filter((recipient) => recipient.status === "queued").length, failed: initialRecipients.filter((recipient) => recipient.status === "failed").length, replay: true };
  if (campaign.status === "launching") throw badRequest("campaign is already launching");

  // Atomically claim the draft before external sends. A concurrent edit or launch
  // must not race with recipient snapshot execution.
  const [claimed] = await db.update(aiCampaigns).set({ status: "launching", lastError: null, updatedAt: new Date() })
    .where(and(eq(aiCampaigns.id, campaign.id), eq(aiCampaigns.userId, ctx.userId), eq(aiCampaigns.accountId, ctx.accountId), eq(aiCampaigns.status, "draft"))).returning({ id: aiCampaigns.id });
  if (!claimed) throw badRequest("campaign is no longer a draft; refresh its status before retrying");
  // Reload the snapshot only after the draft is claimed. Audience edits lock the
  // same campaign row, so in-flight selections cannot leak into an approved send.
  const recipients = await db.select().from(aiCampaignRecipients).where(eq(aiCampaignRecipients.campaignId,campaign.id));

  const mail = createMailService(ctx);
  let sent = 0;
  let failed = 0;

  await runInBatches(recipients.filter((recipient) => recipient.status === "pending" || recipient.status === "failed"), 4, async (recipient) => {
    try {
      const draft = await mail.createDraft(ctx.accountId, {
        to: [recipient.email],
        subject: personalize(campaign.subject, recipient),
        textBody: personalize(campaign.textBody, recipient),
        htmlBody: personalize(campaign.htmlBody, recipient),
        mode: "new",
      });
      const result = await mail.sendDraft(ctx.accountId, draft.engineId, `campaign:${campaign.id}:${recipient.id}`);
      await db.update(aiCampaignRecipients).set({
        status: "queued",
        sendId: result.sendId,
        errorMessage: null,
        updatedAt: new Date(),
      }).where(eq(aiCampaignRecipients.id, recipient.id));
      sent += 1;
    } catch (error) {
      failed += 1;
      await db.update(aiCampaignRecipients).set({
        status: "failed",
        errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
        updatedAt: new Date(),
      }).where(eq(aiCampaignRecipients.id, recipient.id));
    }
  });

  const finalStatus = failed === recipients.length ? "failed" : "launched";
  const lastError = failed ? `${failed} recipient(s) failed to queue` : null;
  const [updated] = await db.update(aiCampaigns).set({
    status: finalStatus,
    launchedAt: finalStatus === "launched" ? new Date() : null,
    lastError,
    updatedAt: new Date(),
  }).where(eq(aiCampaigns.id, campaign.id)).returning();

  return { campaign: updated ?? campaign, sent, failed, replay: false };
}
