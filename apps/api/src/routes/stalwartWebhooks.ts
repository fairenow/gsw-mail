import { createHmac, timingSafeEqual } from "node:crypto";
import { eq, or, sql } from "drizzle-orm";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { emailAccounts, mailAccountMemberships } from "../db/schema.js";
import { sendPushToUser } from "../mobile/expoPush.js";

const processedEvents = pgTable("stalwart_push_events", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

let ensureTablePromise: Promise<unknown> | undefined;
async function ensureProcessedEventsTable(): Promise<void> {
  ensureTablePromise ??= db.execute(sql`
    CREATE TABLE IF NOT EXISTS "stalwart_push_events" (
      "event_id" text PRIMARY KEY,
      "event_type" text NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
  await ensureTablePromise;
}

type StalwartWebhookEvent = { id?: unknown; createdAt?: unknown; type?: unknown; data?: unknown };
type StalwartWebhookBody = { events?: unknown };
type IncomingAccount = { id: string; address: string; ownerUserId: string | null };

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function stringsFrom(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsFrom);
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(stringsFrom);
  return [];
}

function firstText(...values: unknown[]): string | undefined {
  return values.flatMap(stringsFrom).map((value) => value.trim()).find(Boolean);
}

export function extractEmailAddresses(value: unknown): string[] {
  const found = new Set<string>();
  for (const candidate of stringsFrom(value)) {
    for (const match of candidate.match(EMAIL_PATTERN) ?? []) found.add(match.toLowerCase());
  }
  return [...found];
}

export function verifyStalwartWebhookSignature(raw: Buffer, signature: string | string[] | undefined, secret: string): boolean {
  if (!signature) return false;
  const header = Array.isArray(signature) ? signature[0] : signature;
  if (!header) return false;
  const encoded = header.trim().replace(/^sha256=/i, "");
  let offered: Buffer;
  try { offered = Buffer.from(encoded, "base64"); } catch { return false; }
  const expected = createHmac("sha256", secret).update(raw).digest();
  return offered.length === expected.length && timingSafeEqual(offered, expected);
}

function eventRecord(event: StalwartWebhookEvent): Record<string, unknown> {
  return event.data && typeof event.data === "object" && !Array.isArray(event.data) ? event.data as Record<string, unknown> : {};
}

async function claimEvent(eventId: string, eventType: string): Promise<boolean> {
  await ensureProcessedEventsTable();
  const inserted = await db.insert(processedEvents).values({ eventId, eventType }).onConflictDoNothing({ target: processedEvents.eventId }).returning({ eventId: processedEvents.eventId });
  return inserted.length > 0;
}

async function releaseEvent(eventId: string): Promise<void> {
  await db.delete(processedEvents).where(eq(processedEvents.eventId, eventId));
}

async function resolveIncomingAccounts(data: Record<string, unknown>): Promise<{ accounts: IncomingAccount[]; addressCandidates: string[]; principalId: string | null }> {
  const addressCandidates = [...new Set([
    ...extractEmailAddresses(data.accountName),
    ...extractEmailAddresses(data.to),
  ])];
  const principalId = typeof data.accountId === "string" || typeof data.accountId === "number" ? String(data.accountId) : null;
  const found = new Map<string, IncomingAccount>();

  for (const address of addressCandidates) {
    const rows = await db.select({ id: emailAccounts.id, address: emailAccounts.address, ownerUserId: emailAccounts.userId }).from(emailAccounts).where(eq(emailAccounts.address, address)).limit(2);
    for (const row of rows) found.set(row.id, row);
  }

  if (principalId) {
    const rows = await db.select({ id: emailAccounts.id, address: emailAccounts.address, ownerUserId: emailAccounts.userId }).from(emailAccounts).where(or(eq(emailAccounts.stalwartPrincipalId, principalId), eq(emailAccounts.address, principalId))).limit(4);
    for (const row of rows) found.set(row.id, row);
  }

  return { accounts: [...found.values()], addressCandidates, principalId };
}

async function notifyAccount(app: FastifyInstance, account: IncomingAccount, data: Record<string, unknown>, traceId: string) {
  const memberships = await db.select({ userId: mailAccountMemberships.userId }).from(mailAccountMemberships).where(eq(mailAccountMemberships.accountId, account.id));
  const userIds = new Set(memberships.map((membership) => membership.userId));
  if (account.ownerUserId) userIds.add(account.ownerUserId);

  const sender = extractEmailAddresses(data.from)[0];
  const subject = firstText(data.subject, data.Subject);
  const messageId = firstText(data.emailId, data.messageId, data.jmapId);
  const title = sender ? `New email from ${sender}` : "New email";
  const body = subject || `New message for ${account.address}`;

  app.log.info({
    event: "PUSH_TRIGGER_STARTED",
    traceId,
    accountId: account.id,
    mailbox: account.address,
    messageId,
    sender,
    subject,
    userIds: [...userIds],
  }, "new-email push trigger started");

  if (!userIds.size) {
    app.log.warn({ event: "PUSH_SKIPPED", traceId, accountId: account.id, mailbox: account.address, reason: "NO_MAILBOX_USERS" }, "new-email push skipped");
    return [];
  }

  const results = [];
  for (const userId of userIds) {
    try {
      results.push(await sendPushToUser({
        userId,
        title,
        body,
        sound: "gsw-mail-gong.wav",
        channelId: "mail-gong",
        category: "mail",
        traceId,
        data: {
          route: "mail",
          kind: "new-email",
          accountId: account.id,
          folder: "Inbox",
          ...(messageId ? { messageId } : {}),
        },
      }));
    } catch (error) {
      app.log.error({
        event: "PUSH_FAILED",
        traceId,
        accountId: account.id,
        mailbox: account.address,
        userId,
        stage: "sendPushToUser",
        error: error instanceof Error ? error.message : String(error),
      }, "new-email push failed");
      throw error;
    }
  }
  return results;
}

export default async (app: FastifyInstance) => {
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  app.post("/webhooks/stalwart", async (req, reply) => {
    const raw = req.body as Buffer;
    const secret = config.stalwart.webhookSecret;
    if (!secret) {
      req.log.error({ event: "PUSH_FAILED", stage: "webhook_auth", reason: "STALWART_WEBHOOK_SECRET_MISSING" }, "STALWART_WEBHOOK_SECRET is not configured");
      return reply.code(503).send({ error: "stalwart_webhook_not_configured" });
    }
    if (!verifyStalwartWebhookSignature(raw, req.headers["x-signature"], secret)) {
      req.log.warn({ event: "PUSH_FAILED", stage: "webhook_auth", reason: "INVALID_WEBHOOK_SIGNATURE" }, "Stalwart webhook signature rejected");
      return reply.code(401).send({ error: "invalid webhook signature" });
    }

    let payload: StalwartWebhookBody;
    try { payload = JSON.parse(raw.toString("utf8")) as StalwartWebhookBody; }
    catch {
      req.log.warn({ event: "PUSH_FAILED", stage: "webhook_parse", reason: "INVALID_JSON" }, "Stalwart webhook JSON rejected");
      return reply.code(400).send({ error: "invalid JSON body" });
    }

    const events = Array.isArray(payload.events) ? payload.events as StalwartWebhookEvent[] : [];
    req.log.info({ event: "STALWART_WEBHOOK_RECEIVED", eventCount: events.length, eventTypes: events.map((event) => typeof event.type === "string" ? event.type : "unknown") }, "Stalwart webhook received");

    let relevant = 0;
    let duplicate = 0;
    let unresolved = 0;
    let notifiedUsers = 0;
    let acceptedPushes = 0;

    for (const event of events) {
      const eventType = typeof event.type === "string" ? event.type : "";
      if (eventType !== "message-ingest.ham") continue;
      relevant += 1;
      const eventId = typeof event.id === "string" ? event.id : "";
      const data = eventRecord(event);
      const messageId = firstText(data.emailId, data.messageId, data.jmapId);

      req.log.info({
        event: "EMAIL_RECEIVED",
        traceId: eventId || undefined,
        eventType,
        createdAt: event.createdAt,
        messageId,
        dataKeys: Object.keys(data),
        from: extractEmailAddresses(data.from),
        to: extractEmailAddresses(data.to),
        accountName: extractEmailAddresses(data.accountName),
        accountId: data.accountId,
      }, "new email webhook event received");

      req.log.info({ event: "EMAIL_PERSISTED", traceId: eventId || undefined, eventType, messageId }, "Stalwart confirmed message ingestion");

      if (!eventId) {
        req.log.warn({ event: "PUSH_SKIPPED", eventType, messageId, reason: "MISSING_EVENT_ID" }, "Stalwart ingest event omitted id; skipping push to preserve idempotency");
        unresolved += 1;
        continue;
      }
      if (!(await claimEvent(eventId, eventType))) {
        duplicate += 1;
        req.log.info({ event: "PUSH_SKIPPED", traceId: eventId, eventType, messageId, reason: "DUPLICATE_EVENT" }, "duplicate Stalwart event skipped");
        continue;
      }

      try {
        const resolution = await resolveIncomingAccounts(data);
        if (!resolution.accounts.length) {
          unresolved += 1;
          req.log.warn({
            event: "PUSH_SKIPPED",
            traceId: eventId,
            eventType,
            messageId,
            reason: "MAILBOX_NOT_RESOLVED",
            dataKeys: Object.keys(data),
            addressCandidates: resolution.addressCandidates,
            principalId: resolution.principalId,
          }, "Could not map Stalwart ingest event to a GSW mailbox");
          continue;
        }

        req.log.info({
          event: "MAILBOX_RESOLVED",
          traceId: eventId,
          eventType,
          messageId,
          addressCandidates: resolution.addressCandidates,
          principalId: resolution.principalId,
          accounts: resolution.accounts.map((account) => ({ id: account.id, address: account.address, ownerUserId: account.ownerUserId })),
        }, "Stalwart event mapped to GSW mailbox");

        for (const account of resolution.accounts) {
          const deliveries = await notifyAccount(app, account, data, eventId);
          notifiedUsers += deliveries.length;
          acceptedPushes += deliveries.reduce((sum, delivery) => sum + delivery.accepted, 0);
        }
      } catch (error) {
        await releaseEvent(eventId);
        req.log.error({
          event: "PUSH_FAILED",
          traceId: eventId,
          eventType,
          messageId,
          stage: "webhook_pipeline",
          error: error instanceof Error ? error.message : String(error),
        }, "new-email push pipeline failed");
        throw error;
      }
    }

    return { received: true, events: events.length, relevant, duplicate, unresolved, notifiedUsers, acceptedPushes };
  });
};
