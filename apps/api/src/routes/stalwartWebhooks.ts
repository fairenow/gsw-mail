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

async function resolveIncomingAccounts(data: Record<string, unknown>): Promise<IncomingAccount[]> {
  const addressCandidates = new Set<string>([...extractEmailAddresses(data.accountName), ...extractEmailAddresses(data.to)]);
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
  return [...found.values()];
}

async function notifyAccount(account: IncomingAccount, data: Record<string, unknown>) {
  const memberships = await db.select({ userId: mailAccountMemberships.userId }).from(mailAccountMemberships).where(eq(mailAccountMemberships.accountId, account.id));
  const userIds = new Set(memberships.map((membership) => membership.userId));
  if (account.ownerUserId) userIds.add(account.ownerUserId);

  const sender = extractEmailAddresses(data.from)[0];
  const subject = firstText(data.subject, data.Subject);
  const messageId = firstText(data.emailId, data.messageId, data.jmapId);
  const title = sender ? `New email from ${sender}` : "New email";
  const body = subject || `New message for ${account.address}`;
  const results = [];
  for (const userId of userIds) {
    results.push(await sendPushToUser({
      userId,
      title,
      body,
      sound: "gsw-mail-gong.wav",
      channelId: "mail-gong",
      category: "mail",
      data: {
        route: "mail",
        kind: "new-email",
        accountId: account.id,
        folder: "Inbox",
        ...(messageId ? { messageId } : {}),
      },
    }));
  }
  return results;
}

export default async (app: FastifyInstance) => {
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  app.post("/webhooks/stalwart", async (req, reply) => {
    const raw = req.body as Buffer;
    const secret = config.stalwart.webhookSecret;
    if (!secret) {
      req.log.error("STALWART_WEBHOOK_SECRET is not configured");
      return reply.code(503).send({ error: "stalwart_webhook_not_configured" });
    }
    if (!verifyStalwartWebhookSignature(raw, req.headers["x-signature"], secret)) return reply.code(401).send({ error: "invalid webhook signature" });

    let payload: StalwartWebhookBody;
    try { payload = JSON.parse(raw.toString("utf8")) as StalwartWebhookBody; }
    catch { return reply.code(400).send({ error: "invalid JSON body" }); }

    const events = Array.isArray(payload.events) ? payload.events as StalwartWebhookEvent[] : [];
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
      if (!eventId) {
        req.log.warn({ eventType }, "Stalwart ingest event omitted id; skipping push to preserve idempotency");
        unresolved += 1;
        continue;
      }
      if (!(await claimEvent(eventId, eventType))) { duplicate += 1; continue; }

      try {
        const data = eventRecord(event);
        const accounts = await resolveIncomingAccounts(data);
        if (!accounts.length) {
          unresolved += 1;
          req.log.warn({ eventId, eventType, dataKeys: Object.keys(data) }, "Could not map Stalwart ingest event to a GSW mailbox");
          continue;
        }
        for (const account of accounts) {
          const deliveries = await notifyAccount(account, data);
          notifiedUsers += deliveries.length;
          acceptedPushes += deliveries.reduce((sum, delivery) => sum + delivery.accepted, 0);
        }
      } catch (error) {
        await releaseEvent(eventId);
        throw error;
      }
    }

    return { received: true, events: events.length, relevant, duplicate, unresolved, notifiedUsers, acceptedPushes };
  });
};
