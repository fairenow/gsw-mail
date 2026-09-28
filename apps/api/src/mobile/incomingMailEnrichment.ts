import { desc, eq, sql } from "drizzle-orm";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { JmapClient } from "../engine/jmap.js";

const mailboxStates = pgTable("stalwart_push_mailbox_states", {
  accountId: text("account_id").primaryKey(),
  state: text("state").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

const pendingMessages = pgTable("stalwart_push_pending_messages", {
  key: text("key").primaryKey(),
  accountId: text("account_id").notNull(),
  messageId: text("message_id").notNull(),
  discoveredAt: timestamp("discovered_at", { withTimezone: true }).defaultNow().notNull(),
});

let ensureTablesPromise: Promise<unknown> | undefined;
async function ensureTables(): Promise<void> {
  ensureTablesPromise ??= db.execute(sql`
    CREATE TABLE IF NOT EXISTS "stalwart_push_mailbox_states" (
      "account_id" text PRIMARY KEY,
      "state" text NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS "stalwart_push_pending_messages" (
      "key" text PRIMARY KEY,
      "account_id" text NOT NULL,
      "message_id" text NOT NULL,
      "discovered_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS "stalwart_push_pending_account_idx"
      ON "stalwart_push_pending_messages" ("account_id", "discovered_at");
  `);
  await ensureTablesPromise;
}

type JmapAddress = { email?: string; name?: string | null };
type JmapEmail = {
  id?: string;
  receivedAt?: string;
  subject?: string;
  preview?: string;
  from?: JmapAddress[];
};

type ChangesPayload = {
  oldState?: string;
  newState?: string;
  hasMoreChanges?: boolean;
  created?: unknown[];
};

export type EnrichedIncomingMail = {
  messageId: string;
  sender: string;
  senderEmail: string | null;
  subject: string;
  preview: string;
  receivedAt: string | null;
};

export type IncomingMailEnrichmentResult =
  | { status: "resolved"; message: EnrichedIncomingMail }
  | { status: "unavailable"; reason: string };

const normalized = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

function serviceAuthorization(mailbox: string): string | null {
  const username = config.stalwart.pushJmapUsername;
  const password = config.stalwart.pushJmapPassword;
  if (!username || !password) return null;
  const compositeUsername = `${mailbox}%${username}`;
  return `Basic ${Buffer.from(`${compositeUsername}:${password}`, "utf8").toString("base64")}`;
}

function clientForMailbox(mailbox: string): JmapClient | null {
  const authorization = serviceAuthorization(mailbox);
  if (!authorization) return null;
  return new JmapClient({
    baseUrl: config.stalwart.jmapUrl,
    authorization,
    sessionTtlMs: config.stalwart.sessionTtlSeconds * 1000,
  });
}

async function currentEmailState(client: JmapClient, accountId: string): Promise<string> {
  const response = await client.call([["Email/get", { accountId, ids: [], properties: ["id"] }, "state"]]);
  const state = response[0]?.[1]?.state;
  if (typeof state !== "string") throw new Error("Stalwart Email/get did not return an Email state token");
  return state;
}

async function insertPending(productAccountId: string, messageIds: string[]): Promise<void> {
  if (!messageIds.length) return;
  await db.insert(pendingMessages).values(messageIds.map((messageId) => ({
    key: `${productAccountId}:${messageId}`,
    accountId: productAccountId,
    messageId,
  }))).onConflictDoNothing({ target: pendingMessages.key });
}

async function bootstrapPending(client: JmapClient, jmapAccountId: string, productAccountId: string, eventAt: Date): Promise<void> {
  const after = new Date(eventAt.getTime() - 10 * 60_000).toISOString();
  const before = new Date(eventAt.getTime() + 2 * 60_000).toISOString();
  const response = await client.call([["Email/query", {
    accountId: jmapAccountId,
    filter: { after, before },
    sort: [{ property: "receivedAt", isAscending: false }],
    limit: 50,
  }, "bootstrap"]]);
  const ids = Array.isArray(response[0]?.[1]?.ids)
    ? (response[0]![1]!.ids as unknown[]).filter((id): id is string => typeof id === "string")
    : [];
  await insertPending(productAccountId, ids);
}

async function syncCreatedMessages(client: JmapClient, jmapAccountId: string, productAccountId: string, eventAt: Date): Promise<void> {
  await ensureTables();
  const [stored] = await db.select({ state: mailboxStates.state }).from(mailboxStates).where(eq(mailboxStates.accountId, productAccountId)).limit(1);

  if (!stored?.state) {
    await bootstrapPending(client, jmapAccountId, productAccountId, eventAt);
    const state = await currentEmailState(client, jmapAccountId);
    await db.insert(mailboxStates).values({ accountId: productAccountId, state }).onConflictDoUpdate({
      target: mailboxStates.accountId,
      set: { state, updatedAt: new Date() },
    });
    return;
  }

  let sinceState = stored.state;
  const created = new Set<string>();
  for (let page = 0; page < 8; page += 1) {
    const response = await client.call([["Email/changes", { accountId: jmapAccountId, sinceState, maxChanges: 250 }, `changes-${page}`]]);
    const payload = (response[0]?.[1] ?? {}) as ChangesPayload;
    for (const id of payload.created ?? []) if (typeof id === "string") created.add(id);
    if (typeof payload.newState === "string") sinceState = payload.newState;
    if (payload.hasMoreChanges !== true) break;
  }

  await insertPending(productAccountId, [...created]);
  await db.insert(mailboxStates).values({ accountId: productAccountId, state: sinceState }).onConflictDoUpdate({
    target: mailboxStates.accountId,
    set: { state: sinceState, updatedAt: new Date() },
  });
}

function candidateScore(email: JmapEmail, senderEmail: string | undefined, eventAt: Date): number {
  const candidateSender = normalized(email.from?.[0]?.email);
  const wantedSender = normalized(senderEmail);
  if (wantedSender && candidateSender !== wantedSender) return Number.NEGATIVE_INFINITY;

  let score = wantedSender ? 100 : 0;
  const receivedAt = email.receivedAt ? Date.parse(email.receivedAt) : Number.NaN;
  if (Number.isFinite(receivedAt)) {
    const deltaMs = Math.abs(receivedAt - eventAt.getTime());
    if (deltaMs > 30 * 60_000) return Number.NEGATIVE_INFINITY;
    score += Math.max(0, 60 - deltaMs / 30_000);
  }
  return score;
}

export function pickBestIncomingMessage(emails: JmapEmail[], senderEmail: string | undefined, eventAt: Date): JmapEmail | null {
  const ranked = emails
    .map((email) => ({ email, score: candidateScore(email, senderEmail, eventAt) }))
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.email ?? null;
}

export async function resolveIncomingMailForPush(input: {
  productAccountId: string;
  mailbox: string;
  senderEmail?: string | undefined;
  eventCreatedAt?: unknown;
}): Promise<IncomingMailEnrichmentResult> {
  const client = clientForMailbox(input.mailbox);
  if (!client) return { status: "unavailable", reason: "BACKGROUND_JMAP_CREDENTIALS_NOT_CONFIGURED" };

  const parsedEventAt = typeof input.eventCreatedAt === "string" || typeof input.eventCreatedAt === "number"
    ? new Date(input.eventCreatedAt)
    : new Date();
  const eventAt = Number.isNaN(parsedEventAt.getTime()) ? new Date() : parsedEventAt;

  try {
    const session = await client.session();
    const jmapAccountId = client.resolveAccountId(session, input.mailbox);
    await syncCreatedMessages(client, jmapAccountId, input.productAccountId, eventAt);

    const pending = await db.select({ key: pendingMessages.key, messageId: pendingMessages.messageId })
      .from(pendingMessages)
      .where(eq(pendingMessages.accountId, input.productAccountId))
      .orderBy(desc(pendingMessages.discoveredAt))
      .limit(50);
    if (!pending.length) return { status: "unavailable", reason: "NO_PENDING_JMAP_MESSAGES" };

    const response = await client.call([["Email/get", {
      accountId: jmapAccountId,
      ids: pending.map((item) => item.messageId),
      properties: ["id", "receivedAt", "subject", "preview", "from"],
    }, "push-email"]]);
    const list = Array.isArray(response[0]?.[1]?.list) ? response[0]![1]!.list as JmapEmail[] : [];
    const selected = pickBestIncomingMessage(list, input.senderEmail, eventAt);
    if (!selected?.id) return { status: "unavailable", reason: "JMAP_MESSAGE_NOT_MATCHED" };

    await db.delete(pendingMessages).where(eq(pendingMessages.key, `${input.productAccountId}:${selected.id}`));
    const from = selected.from?.[0];
    const senderEmail = from?.email?.trim() || input.senderEmail?.trim() || null;
    const sender = from?.name?.trim() || senderEmail || "New email";
    const subject = selected.subject?.trim() || "(No subject)";
    const preview = selected.preview?.replace(/\s+/g, " ").trim() || "Open GSW Mail to read this message.";

    return {
      status: "resolved",
      message: {
        messageId: selected.id,
        sender,
        senderEmail,
        subject,
        preview: preview.length > 280 ? `${preview.slice(0, 279).trimEnd()}…` : preview,
        receivedAt: selected.receivedAt ?? null,
      },
    };
  } catch (error) {
    return {
      status: "unavailable",
      reason: error instanceof Error ? `BACKGROUND_JMAP_FAILED:${error.message}` : "BACKGROUND_JMAP_FAILED",
    };
  }
}
