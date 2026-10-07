import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  aiCampaignRecipients,
  aiCampaigns,
  contactEmails,
  contactTags,
  contacts,
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
  if (recipients.length > 250) throw badRequest("campaign audiences are currently limited to 250 recipients per launch");

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
  const { campaign, recipients } = await getCampaign(ctx.userId, campaignId);
  if (campaign.accountId !== ctx.accountId) throw badRequest("campaign belongs to a different mailbox");
  if (campaign.status === "launched") return { campaign, sent: recipients.filter((recipient) => recipient.status === "queued").length, failed: recipients.filter((recipient) => recipient.status === "failed").length, replay: true };
  if (campaign.status === "launching") throw badRequest("campaign is already launching");

  await db.update(aiCampaigns).set({ status: "launching", lastError: null, updatedAt: new Date() }).where(eq(aiCampaigns.id, campaign.id));

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
