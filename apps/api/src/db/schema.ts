import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => sql`now()`),
};

export const accountStatus = pgEnum("account_status", ["pending", "active", "disabled"]);
export const domainStatus = pgEnum("domain_status", ["pending", "verified", "failed"]);
export const recordStatus = pgEnum("record_status", ["not_configured", "verifying", "verified", "failed"]);
export const aliasStatus = pgEnum("alias_status", ["active", "disabled"]);
export const mailboxRole = pgEnum("mailbox_role", ["inbox", "sent", "drafts", "spam", "trash", "archive"]);
export const outboundStatus = pgEnum("outbound_status", [
  "draft",
  "queued",
  "sending",
  "sent",
  "delivered",
  "deferred",
  "bounced",
  "failed",
]);
export const deliveryEventType = pgEnum("delivery_event_type", [
  "sent",
  "delivered",
  "deferred",
  "bounced",
  "complained",
  "failed",
]);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("organizations_slug_idx").on(t.slug)],
);

export const domains = pgTable(
  "domains",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: domainStatus("domain_status").default("pending").notNull(),
    mxStatus: recordStatus("mx_status").default("not_configured").notNull(),
    spfStatus: recordStatus("spf_status").default("not_configured").notNull(),
    dkimStatus: recordStatus("dkim_status").default("not_configured").notNull(),
    dmarcStatus: recordStatus("dmarc_status").default("not_configured").notNull(),
    dkimSelector: text("dkim_selector"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("domains_name_idx").on(t.name),
    index("domains_org_idx").on(t.organizationId),
  ],
);

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name"),
    status: text("status").default("active").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const emailAccounts = pgTable(
  "email_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    domainId: uuid("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "restrict" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    localPart: text("local_part").notNull(),
    address: text("address").notNull(),
    displayName: text("display_name"),
    status: accountStatus("account_status").default("pending").notNull(),
    quotaBytes: bigint("quota_bytes", { mode: "number" }),
    usedBytes: bigint("used_bytes", { mode: "number" }).default(0).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("email_accounts_address_idx").on(t.address),
    index("email_accounts_user_idx").on(t.userId),
    index("email_accounts_domain_idx").on(t.domainId),
  ],
);

export const aliases = pgTable(
  "aliases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    domainId: uuid("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    targetAccountId: uuid("target_account_id").references(() => emailAccounts.id, {
      onDelete: "set null",
    }),
    status: aliasStatus("alias_status").default("active").notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("aliases_source_idx").on(t.domainId, t.source),
    index("aliases_target_idx").on(t.targetAccountId),
  ],
);

export const mailboxes = pgTable(
  "mailboxes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => emailAccounts.id, { onDelete: "cascade" }),
    role: mailboxRole("mailbox_role").notNull(),
    engineName: text("engine_name").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("mailboxes_account_role_idx").on(t.accountId, t.role)],
);

export const outboundMessages = pgTable(
  "outbound_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => emailAccounts.id, { onDelete: "restrict" }),
    status: outboundStatus("outbound_status").default("queued").notNull(),
    fromAddress: text("from_address").notNull(),
    to: jsonb("to").$type<string[]>().notNull(),
    cc: jsonb("cc").$type<string[]>().default(sql`'[]'::jsonb`),
    bcc: jsonb("bcc").$type<string[]>().default(sql`'[]'::jsonb`),
    subject: text("subject"),
    textBody: text("text_body"),
    htmlBody: text("html_body"),
    replyTo: text("reply_to"),
    inReplyTo: text("in_reply_to"),
    references: text("references"),
    messageId: text("message_id"),
    clientRequestId: text("client_request_id"),
    attempts: integer("attempts").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(5).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [
    index("outbound_status_idx").on(t.status),
    index("outbound_account_idx").on(t.accountId),
    index("outbound_next_attempt_idx").on(t.status, t.nextAttemptAt),
    uniqueIndex("outbound_client_request_idx").on(t.clientRequestId),
  ],
);

export const outboundDeliveryEvents = pgTable(
  "outbound_delivery_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    outboundMessageId: uuid("outbound_message_id")
      .notNull()
      .references(() => outboundMessages.id, { onDelete: "cascade" }),
    type: deliveryEventType("delivery_event_type").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    providerEventId: text("provider_event_id"),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("delivery_event_msg_idx").on(t.outboundMessageId),
    uniqueIndex("delivery_event_provider_idx").on(t.providerEventId),
  ],
);

export const messageThreads = pgTable(
  "message_threads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => emailAccounts.id, { onDelete: "cascade" }),
    engineThreadId: text("engine_thread_id").notNull(),
    subject: text("subject"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull(),
    messageCount: integer("message_count").default(0).notNull(),
    read: boolean("read").default(false).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("message_threads_account_engine_idx").on(t.accountId, t.engineThreadId),
    index("message_threads_account_idx").on(t.accountId),
  ],
);

export const inboundMessages = pgTable(
  "inbound_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => emailAccounts.id, { onDelete: "cascade" }),
    engineId: text("engine_id").notNull(),
    engineThreadId: text("engine_thread_id"),
    mailboxRole: mailboxRole("mailbox_role").default("inbox").notNull(),
    fromEmail: text("from_email").notNull(),
    fromName: text("from_name"),
    to: jsonb("to").$type<string[]>().default(sql`'[]'::jsonb`),
    cc: jsonb("cc").$type<string[]>().default(sql`'[]'::jsonb`),
    subject: text("subject"),
    snippet: text("snippet"),
    read: boolean("read").default(false).notNull(),
    flagged: boolean("flagged").default(false).notNull(),
    hasAttachments: boolean("has_attachments").default(false).notNull(),
    size: integer("size").default(0).notNull(),
    date: timestamp("date", { withTimezone: true }).notNull(),
    spf: text("spf"),
    dkim: text("dkim"),
    dmarc: text("dmarc"),
    spamScore: numeric("spam_score", { precision: 4, scale: 2 }),
    keywords: jsonb("keywords").$type<string[]>().default(sql`'[]'::jsonb`),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("inbound_account_engine_idx").on(t.accountId, t.engineId),
    index("inbound_account_mailbox_idx").on(t.accountId, t.mailboxRole),
    index("inbound_thread_idx").on(t.engineThreadId),
    index("inbound_date_idx").on(t.date),
  ],
);