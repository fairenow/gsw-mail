import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/middleware.js";
import { requireAccountPermission } from "../auth/authorize.js";
import { previewCampaign,replaceCampaignAudience,updateDraftCampaign } from "../ai/campaignService.js";
import { db } from "../db/client.js";
import { contactEmails, contactImportBatches, contactImportRows, contacts, emailSignatures, userSettings } from "../db/schema.js";
import { createContact, getContact, getContactEngineContext, listContacts, normalizeEmail, type ContactInput, updateContact } from "../lib/contacts.js";
import { notFound } from "../lib/errors.js";
import { mergeImportedEmails, validateImportedEmails } from "../lib/contactImport.js";
import { richTextToPlainText, sanitizeRichText } from "../lib/richText.js";
import { getEngine, getUserEngine } from "../engine/index.js";
import { getAssetForUser } from "../files/service.js";
import { badRequest } from "../lib/errors.js";
import { emailAccounts, mailAccountMemberships } from "../db/schema.js";
import { config } from "../config.js";

const customValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const contactInput = z.object({
  firstName: z.string().optional(), middleName: z.string().optional(), lastName: z.string().optional(), displayName: z.string().optional(),
  organization: z.string().optional(), jobTitle: z.string().optional(), website: z.string().optional(), address: z.string().optional(), city: z.string().optional(),
  state: z.string().optional(), postalCode: z.string().optional(), country: z.string().optional(), notes: z.string().optional(),
  emails: z.array(z.object({ email: z.string().email(), label: z.string().optional(), isPrimary: z.boolean().optional() })).optional(),
  phones: z.array(z.object({ phone: z.string(), label: z.string().optional(), isPrimary: z.boolean().optional() })).optional(),
  tags: z.array(z.string()).optional(), customFields: z.record(z.string(), customValue).optional(), source: z.string().optional(), sourceFile: z.string().optional(),
});
const profileImageUrl = z.string().max(2_048).refine((value) => {
  if (!value) return true;
  if (/^\/product\/files\/[0-9a-f-]{36}\/content$/i.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}, "profile image URL must be http(s) or a GSW Files asset URL");
const settingsSchema = z.object({ general: z.object({
  profileImageUrl: profileImageUrl.optional(),
  profileImageAssetId: z.string().uuid().nullable().optional(),
}).catchall(customValue).optional(), compose: z.record(z.string(), customValue).optional(), contacts: z.record(z.string(), customValue).optional(), ai: z.record(z.string(), customValue).optional() });
const signatureSchema = z.object({ signatureHtml: z.string().max(100_000), enabled: z.boolean(), onNew: z.boolean(), onReply: z.boolean(), onForward: z.boolean(), position: z.enum(["beforeQuotedText", "afterQuotedText"]) });
const importSchema = z.object({ filename: z.string().min(1).max(255), headers: z.array(z.string()).min(1), rows: z.array(z.record(z.string(), z.string())).max(10_000), mapping: z.record(z.string(), z.string()), duplicateBehavior: z.enum(["skip", "merge", "overwrite"]).default("merge") });
const calendarEventSchema = z.object({ accountId: z.string().min(1), calendarId: z.string().min(1), title: z.string().trim().min(1).max(500), description: z.string().max(20_000).optional(), start: z.string().min(1), durationMinutes: z.number().int().min(1).max(7 * 24 * 60), location: z.string().max(1_000).optional(), meetingLink: z.string().url().max(2_000).optional(), attendees: z.array(z.string().email()).max(50).default([]), sendSchedulingMessages: z.boolean().default(false), timeZone: z.string().max(100).optional(), allDay: z.boolean().default(false) });

export default async function productRoutes(app: FastifyInstance) {
  await requireUser(app, { optional: false });

  app.get("/product/settings", async (req) => {
    const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, req.user!.id)).limit(1);
    const [signature] = await db.select().from(emailSignatures).where(eq(emailSignatures.userId, req.user!.id)).limit(1);
    return {
      general: settings?.general ?? { timezone: "America/Detroit", language: "en-US" },
      compose: settings?.compose ?? { defaultFormat: "rich" },
      contacts: settings?.contacts ?? { autoCreateFromSent: true },
      ai: {
        ...(settings?.ai ?? {}),
        enabled: settings?.ai?.enabled !== false,
        modelProvider: settings?.ai?.modelProvider === "openai" || settings?.ai?.modelProvider === "claude" || settings?.ai?.modelProvider === "qwen" || settings?.ai?.modelProvider === "gpt-oss-120b" || settings?.ai?.modelProvider === "deepseek-v4.1-flash"
          ? settings.ai.modelProvider
          : "gpt-oss-120b",
        mailRead: settings?.ai?.mailRead !== false,
        draftMutation: settings?.ai?.draftMutation !== false,
        emailSend: settings?.ai?.emailSend !== false,
        scheduledWork: settings?.ai?.scheduledWork !== false,
        campaignLaunch: settings?.ai?.campaignLaunch !== false,
        fileAccess: settings?.ai?.fileAccess !== false,
        imageGeneration: settings?.ai?.imageGeneration !== false,
      },
      signature: signature ? { ...signature, signatureHtml: signature.signatureHtml, signatureText: signature.signatureText } : defaultSignature(),
    };
  });

  app.patch("/product/settings", async (req) => {
    const input = settingsSchema.parse(req.body);
    const requestedModelProvider = input.ai?.modelProvider;
    if (requestedModelProvider !== undefined) {
      if (requestedModelProvider !== "qwen" && requestedModelProvider !== "openai" && requestedModelProvider !== "claude" && requestedModelProvider !== "gpt-oss-120b" && requestedModelProvider !== "deepseek-v4.1-flash") {
        throw badRequest("AI model must be Qwen, GPT-OSS 120B, DeepSeek, OpenAI, or Claude.");
      }
      if (requestedModelProvider === "qwen" && !config.ai.hetznerApiKey) {
        throw badRequest("Qwen is not configured for this GSW Mail deployment.");
      }
      if (requestedModelProvider === "gpt-oss-120b" && (!config.ai.modalProxyToken || !config.ai.gptOssVllmBaseUrl)) {
        throw badRequest("GPT-OSS 120B is not configured on Modal.");
      }
      if (requestedModelProvider === "deepseek-v4.1-flash" && (!config.ai.modalProxyToken || !process.env.DEEPSEEK_BASE_URL)) {
        throw badRequest("DeepSeek is not configured on Modal.");
      }
      if (requestedModelProvider === "openai" && (!config.ai.openaiApiKey || !config.ai.openaiModel)) {
        throw badRequest("OpenAI is not configured for this GSW Mail deployment.");
      }
      if (requestedModelProvider === "claude" && (!config.ai.anthropicApiKey || !config.ai.anthropicModel)) {
        throw badRequest("Claude is not configured for this GSW Mail deployment.");
      }
    }
    const [current] = await db.select().from(userSettings).where(eq(userSettings.userId, req.user!.id)).limit(1);
    let nextGeneral = { ...(current?.general ?? {}), ...(input.general ?? {}) };
    if (input.general && "profileImageAssetId" in input.general) {
      const assetId = input.general.profileImageAssetId;
      if (assetId) {
        const asset = await getAssetForUser(req.user!.id, assetId);
        if (!asset.mimeType.startsWith("image/")) throw badRequest("profile image must be an image");
        nextGeneral = {
          ...nextGeneral,
          profileImageAssetId: asset.id,
          profileImageUrl: `/product/files/${asset.id}/content`,
        };
      } else {
        nextGeneral = { ...nextGeneral, profileImageAssetId: null, profileImageUrl: "" };
      }
    }
    const [saved] = await db.insert(userSettings).values({
      userId: req.user!.id,
      general: nextGeneral,
      compose: { ...(current?.compose ?? {}), ...(input.compose ?? {}) },
      contacts: { ...(current?.contacts ?? {}), ...(input.contacts ?? {}) },
      ai: { ...(current?.ai ?? {}), ...(input.ai ?? {}) },
    }).onConflictDoUpdate({ target: userSettings.userId, set: { general: nextGeneral, compose: { ...(current?.compose ?? {}), ...(input.compose ?? {}) }, contacts: { ...(current?.contacts ?? {}), ...(input.contacts ?? {}) }, ai: { ...(current?.ai ?? {}), ...(input.ai ?? {}) } } }).returning();
    return saved;
  });

  app.put("/product/signature", async (req) => {
    const input = signatureSchema.parse(req.body);
    const signatureHtml = sanitizeRichText(input.signatureHtml);
    const signatureText = richTextToPlainText(signatureHtml);
    const [saved] = await db.insert(emailSignatures).values({ userId: req.user!.id, signatureHtml, signatureText, enabled: input.enabled, onNew: input.onNew, onReply: input.onReply, onForward: input.onForward, position: input.position })
      .onConflictDoUpdate({ target: emailSignatures.userId, set: { signatureHtml, signatureText, enabled: input.enabled, onNew: input.onNew, onReply: input.onReply, onForward: input.onForward, position: input.position } }).returning();
    return saved;
  });

  app.get("/product/contacts", async (req) => {
    const params = req.query as { q?: unknown; limit?: unknown; offset?: unknown };
    const query = String(params?.q ?? "");
    const requestedLimit = Number(params?.limit ?? 100);
    const requestedOffset = Number(params?.offset ?? 0);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 100) : 100;
    const offset = Number.isFinite(requestedOffset) ? Math.max(Math.trunc(requestedOffset), 0) : 0;
    return listContacts(req.user!.id, query, limit, offset, await getContactEngineContext(req.user!.id, req.accessToken, req.authUserId, req.headers as Record<string, string>));
  });

  app.get("/product/contacts/address-books", async (req) => {
    const context = await getContactEngineContext(req.user!.id, req.accessToken, req.authUserId, req.headers as Record<string, string>);
    return { addressBooks: context ? await context.engine.listAddressBooks(context.accountId) : [] };
  });

  app.get("/product/calendars", async (req) => {
    const engineContext = await getCalendarEngineContext(req.user?.id, req.authUserId, req.headers as Record<string, string>, req.query);
    return { calendars: engineContext ? await engineContext.engine.listCalendars(engineContext.accountId) : [] };
  });

  app.get("/product/calendar-events", async (req) => {
    const params = req.query as { accountId?: unknown; after?: unknown; before?: unknown };
    const now = new Date();
    const after = typeof params.after === "string" ? params.after : new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const before = typeof params.before === "string" ? params.before : new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
    const engineContext = await getCalendarEngineContext(req.user?.id, req.authUserId, req.headers as Record<string, string>, req.query);
    return { events: engineContext ? await engineContext.engine.listCalendarEvents(engineContext.accountId, after, before) : [] };
  });

  app.post("/product/calendar-events", async (req, reply) => {
    const input = calendarEventSchema.parse(req.body);
    const engineContext = await getCalendarEngineContext(req.user?.id, req.authUserId, req.headers as Record<string, string>, input);
    if (!engineContext) throw notFound("mail account not found");
    const event = await engineContext.engine.createCalendarEvent(engineContext.accountId, input);
    reply.code(201);
    return event;
  });

  app.patch<{ Params: { id: string } }>("/product/calendar-events/:id", async (req) => {
    const input = calendarEventSchema.parse(req.body);
    const engineContext = await getCalendarEngineContext(req.user?.id, req.authUserId, req.headers as Record<string, string>, input);
    if (!engineContext) throw notFound("mail account not found");
    return engineContext.engine.updateCalendarEvent(engineContext.accountId, req.params.id, input);
  });

  app.delete<{ Params: { id: string }; Querystring: { accountId?: string } }>("/product/calendar-events/:id", async (req) => {
    const engineContext = await getCalendarEngineContext(req.user?.id, req.authUserId, req.headers as Record<string, string>, req.query);
    if (!engineContext) throw notFound("mail account not found");
    await engineContext.engine.destroyCalendarEvent(engineContext.accountId, req.params.id);
    return { deleted: true, eventId: req.params.id };
  });

  app.get<{ Params: { id: string } }>("/product/contacts/:id", async (req) => {
    const contact = await getContact(req.user!.id, req.params.id, await getContactEngineContext(req.user!.id, req.accessToken, req.authUserId, req.headers as Record<string, string>));
    if (!contact) throw notFound("contact not found");
    return contact;
  });

  app.post("/product/contacts", async (req, reply) => {
    const input = contactInput.parse(req.body);
    const contact = await createContact(req.user!.id, input, undefined, await getContactEngineContext(req.user!.id, req.accessToken, req.authUserId, req.headers as Record<string, string>));
    reply.code(201);
    return contact;
  });

  app.patch<{ Params: { id: string } }>("/product/contacts/:id", async (req) => {
    const input = contactInput.parse(req.body);
    const contact = await updateContact(req.user!.id, req.params.id, input, await getContactEngineContext(req.user!.id, req.accessToken, req.authUserId, req.headers as Record<string, string>));
    if (!contact) throw notFound("contact not found");
    return contact;
  });

  app.get("/product/contact-imports", async (req) => {
    const batches = await db.select().from(contactImportBatches).where(eq(contactImportBatches.ownerUserId, req.user!.id)).orderBy(contactImportBatches.createdAt);
    return { imports: batches };
  });

  app.get<{ Params: { id: string } }>("/product/contact-imports/:id/rows", async (req) => {
    const [batch] = await db.select({ id: contactImportBatches.id }).from(contactImportBatches).where(and(eq(contactImportBatches.id, req.params.id), eq(contactImportBatches.ownerUserId, req.user!.id))).limit(1);
    if (!batch) throw notFound("import not found");
    return { rows: await db.select().from(contactImportRows).where(eq(contactImportRows.batchId, req.params.id)).orderBy(contactImportRows.rowNumber) };
  });

  app.post("/product/contact-imports", async (req, reply) => {
    const input = importSchema.parse(req.body);
    const context = await getContactEngineContext(req.user!.id, req.accessToken, req.authUserId, req.headers as Record<string, string>);
    const [batch] = await db.insert(contactImportBatches).values({ ownerUserId: req.user!.id, filename: input.filename, rowCount: input.rows.length }).returning();
    if (!batch) throw new Error("failed to create import batch");
    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let duplicateCount = 0;
    let failedCount = 0;
    for (const [index, row] of input.rows.entries()) {
      try {
        const mapped = mapImportRow(row, input.mapping);
        validateImportContact(mapped);
        const existing = await db.select({ contactId: contactEmails.contactId }).from(contactEmails).innerJoin(contacts, eq(contactEmails.contactId, contacts.id)).where(and(eq(contacts.ownerUserId, req.user!.id), eq(contactEmails.normalizedEmail, normalizeEmail(mapped.emails[0]!.email)))).limit(1);
        let contactId: string | undefined;
        let status = "created";
        if (existing[0]) {
          duplicateCount += 1;
          contactId = existing[0].contactId;
          if (input.duplicateBehavior === "skip") { skippedCount += 1; status = "skipped"; }
          else {
            const current = await getContact(req.user!.id, contactId, context);
            if (!current) throw new Error("duplicate contact disappeared");
            const merged = input.duplicateBehavior === "merge" ? mergeContact(current, mapped) : mapped;
            await updateContact(req.user!.id, contactId, merged, context);
            updatedCount += 1;
            status = "updated";
          }
        } else {
          const created = await createContact(req.user!.id, { ...mapped, source: "csv_import", sourceFile: input.filename }, { importBatchId: batch.id }, context);
          contactId = created?.id;
          createdCount += 1;
        }
        await db.insert(contactImportRows).values({ batchId: batch.id, rowNumber: index + 2, raw: row, status, contactId });
      } catch (error) {
        failedCount += 1;
        await db.insert(contactImportRows).values({ batchId: batch.id, rowNumber: index + 2, raw: row, status: "failed", error: importErrorMessage(error) });
      }
    }
    const [updatedBatch] = await db.update(contactImportBatches).set({ createdCount, updatedCount, skippedCount, duplicateCount, failedCount }).where(eq(contactImportBatches.id, batch.id)).returning();
    reply.code(201);
    return updatedBatch;
  });
  // Campaign review is available to the authenticated owner; only an explicit
  // Chat confirmation may launch a campaign. These routes never send email.
  app.get("/product/campaigns/:id/review", async req => {
    const { id } = z.object({ id:z.string().uuid() }).parse(req.params);
    const { accountId } = z.object({ accountId:z.string().uuid() }).parse(req.query);
    await requireAccountPermission(req.user!.id,accountId,"read");
    return previewCampaign({userId:req.user!.id,accountId,campaignId:id});
  });

  app.put("/product/campaigns/:id/audience", async req => {
    const { id } = z.object({ id:z.string().uuid() }).parse(req.params);
    const { accountId, contactIds } = z.object({
      accountId:z.string().uuid(),contactIds:z.array(z.string().uuid()).min(1).max(100),
    }).parse(req.body);
    await requireAccountPermission(req.user!.id,accountId,"send");
    return replaceCampaignAudience({userId:req.user!.id,accountId,campaignId:id,contactIds});
  });

  app.patch("/product/campaigns/:id/draft", async req => {
    const { id } = z.object({ id:z.string().uuid() }).parse(req.params);
    const { accountId, ...changes } = z.object({
      accountId:z.string().uuid(),subject:z.string().trim().min(1).max(998).optional(),
      textBody:z.string().max(200000).optional(),htmlBody:z.string().max(500000).optional(),
      attachmentAssetIds:z.array(z.string().uuid()).max(5).optional(),
    }).refine(input=>input.subject!==undefined||input.textBody!==undefined||input.htmlBody!==undefined||input.attachmentAssetIds!==undefined).parse(req.body);
    await requireAccountPermission(req.user!.id,accountId,"send");
    const saved=await updateDraftCampaign({userId:req.user!.id,accountId,campaignId:id,...changes});
    return { id:saved.id,status:saved.status,recipientCount:saved.recipientCount,attachmentAssetIds:saved.attachmentAssetIds };
  });


}

async function getCalendarEngineContext(userId: string | undefined, authUserId: string | undefined, headers: Record<string, string>, query: unknown) {
  if (!userId) return undefined;
  const params = (query ?? {}) as { accountId?: unknown };
  const requestedAccountId = typeof params.accountId === "string" ? params.accountId : undefined;
  const account = requestedAccountId
    ? (await db.select({ id: emailAccounts.id }).from(emailAccounts).where(eq(emailAccounts.id, requestedAccountId)).limit(1))[0]
    : (await db.select({ id: emailAccounts.id }).from(emailAccounts).where(eq(emailAccounts.userId, userId)).limit(1))[0]
      ?? (await db.select({ id: emailAccounts.id }).from(mailAccountMemberships).innerJoin(emailAccounts, eq(mailAccountMemberships.accountId, emailAccounts.id)).where(eq(mailAccountMemberships.userId, userId)).limit(1))[0];
  if (!account) return undefined;
  const engine = authUserId ? await getUserEngine({ productUserId: userId, authUserId, accountId: account.id, headers }) : getEngine();
  return engine ? { accountId: account.id, engine } : undefined;
}

function defaultSignature() {
  return { id: null, signatureHtml: "", signatureText: "", enabled: true, onNew: true, onReply: true, onForward: true, position: "beforeQuotedText" as const };
}

function mapImportRow(row: Record<string, string>, mapping: Record<string, string>): ContactInput {
  const result: ContactInput = { emails: [], phones: [], tags: [], customFields: {} };
  const coreFields = new Set(["firstName", "middleName", "lastName", "displayName", "organization", "jobTitle", "website", "address", "city", "state", "postalCode", "country", "notes"]);
  for (const [column, target] of Object.entries(mapping)) {
    const value = row[column]?.trim();
    if (!value) continue;
    if (target === "ignore") { result.customFields![column] = value; continue; }
    if (target === "email") result.emails!.push(...value.split(/[;,\s]+/).filter(Boolean).map((email) => ({ email })));
    else if (target === "phone") result.phones!.push({ phone: value });
    else if (target === "tags") result.tags!.push(...value.split(/[;,]/).map((tag) => tag.trim()).filter(Boolean));
    else if (target.startsWith("custom:")) result.customFields![target.slice(7)] = value;
    else if (coreFields.has(target)) (result as Record<string, unknown>)[target] = value;
    else result.customFields![target] = value;
  }
  if (!result.emails?.length) delete result.emails;
  if (!result.phones?.length) delete result.phones;
  if (!result.tags?.length) delete result.tags;
  return result;
}

function validateImportContact(input: ContactInput): asserts input is ContactInput & { emails: { email: string; label?: string; isPrimary?: boolean }[] } {
  input.emails = validateImportedEmails(input.emails);
}

function importErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("contact_emails_contact_normalized_idx")) return "duplicate email in contact row";
  if (message.includes("contact_custom_fields_contact_key_idx")) return "duplicate custom field in contact row";
  return message;
}

function mergeContact(current: NonNullable<Awaited<ReturnType<typeof getContact>>>, incoming: ContactInput): ContactInput {
  const phones = uniqueBy(
    [...current.phones, ...(incoming.phones ?? [])].map((item) => ({ phone: item.phone, label: item.label ?? undefined, isPrimary: item.isPrimary })),
    (item) => item.phone.trim(),
  );
  return {
    firstName: current.firstName || incoming.firstName, middleName: current.middleName || incoming.middleName, lastName: current.lastName || incoming.lastName,
    displayName: current.displayName || incoming.displayName, organization: current.organization || incoming.organization, jobTitle: current.jobTitle || incoming.jobTitle,
    website: current.website || incoming.website, address: current.address || incoming.address, city: current.city || incoming.city, state: current.state || incoming.state,
    postalCode: current.postalCode || incoming.postalCode, country: current.country || incoming.country, notes: current.notes || incoming.notes,
    emails: mergeImportedEmails(current.emails.map((item) => ({ email: item.email, label: item.label ?? undefined, isPrimary: item.isPrimary })), incoming.emails ?? []),
    phones, tags: [...new Set([...current.tags, ...(incoming.tags ?? [])])],
    customFields: { ...current.customFields, ...(incoming.customFields ?? {}) }, source: current.source,
  };
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });

}
