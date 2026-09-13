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
    .$onUpdate(() => new Date()),
};

export const accountStatus = pgEnum("account_status", ["pending", "active", "disabled"]);
export const domainStatus = pgEnum("domain_status", ["pending", "verified", "failed"]);
export const recordStatus = pgEnum("record_status", ["not_configured", "verifying", "verified", "failed"]);
export const aliasStatus = pgEnum("alias_status", ["active", "disabled"]);
export const mailboxRole = pgEnum("mailbox_role", ["inbox", "sent", "drafts", "spam", "trash", "archive"]);
export const userStatus = pgEnum("user_status", ["active", "suspended", "disabled"]);
export const orgMembershipRole = pgEnum("org_membership_role", ["owner", "admin", "member"]);
export const orgMembershipStatus = pgEnum("org_membership_status", ["invited", "active", "suspended"]);
export const accountMembershipRole = pgEnum("account_membership_role", ["owner", "delegate", "read_only"]);
export const transportStatus = pgEnum("transport_status", [
  "preparing",
  "queued",
  "sending",
  "accepted",
  "failed",
  "cancelled",
]);
export const deliveryStatus = pgEnum("delivery_status", [
  "pending",
  "delivered",
  "deferred",
  "bounced",
  "complained",
  "partial_failure",
]);
export const recipientType = pgEnum("recipient_type", ["to", "cc", "bcc"]);
export const recipientDeliveryStatus = pgEnum("recipient_delivery_status", [
  "pending",
  "delivered",
  "deferred",
  "bounced",
  "complained",
]);
export const suppressionReason = pgEnum("suppression_reason", ["hard_bounce", "complaint", "manual"]);
export const deliveryEventType = pgEnum("delivery_event_type", [
  "sent",
  "delivered",
  "deferred",
  "bounced",
  "complained",
  "failed",
]);
export const signaturePosition = pgEnum("signature_position", ["beforeQuotedText", "afterQuotedText"]);
export const contactImportDuplicateBehavior = pgEnum("contact_import_duplicate_behavior", ["skip", "merge", "overwrite"]);

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

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    identityProvider: text("identity_provider").default("gsw").notNull(),
    identitySubject: text("identity_subject").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    name: text("name"),
    status: userStatus("user_status").default("active").notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("users_identity_idx").on(t.identityProvider, t.identitySubject),
    index("users_email_idx").on(t.email),
  ],
);

export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: orgMembershipRole("org_membership_role").default("member").notNull(),
    status: orgMembershipStatus("org_membership_status").default("active").notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("org_memberships_org_user_idx").on(t.organizationId, t.userId),
    index("org_memberships_user_idx").on(t.userId),
  ],
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

export const mailAccountMemberships = pgTable(
  "mail_account_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => emailAccounts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: accountMembershipRole("account_membership_role").default("delegate").notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("account_memberships_account_user_idx").on(t.accountId, t.userId),
    index("account_memberships_user_idx").on(t.userId),
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
    transportStatus: transportStatus("transport_status").default("preparing").notNull(),
    deliveryStatus: deliveryStatus("delivery_status").default("pending").notNull(),
    fromAddress: text("from_address").notNull(),
    to: jsonb("to").$type<string[]>().notNull(),
    cc: jsonb("cc").$type<string[]>().default(sql`'[]'::jsonb`),
    bcc: jsonb("bcc").$type<string[]>().default(sql`'[]'::jsonb`),
    subject: text("subject"),
    textBody: text("text_body"),
    htmlBody: text("html_body"),
    templateKey: text("template_key").notNull().default("gsw_default"),
    replyTo: text("reply_to"),
    inReplyTo: text("in_reply_to"),
    references: text("references"),
    messageId: text("message_id"),
    clientRequestId: text("client_request_id"),
    engineMessageId: text("engine_message_id"),
    engineThreadId: text("engine_thread_id"),
    attempts: integer("attempts").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(5).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    undoUntil: timestamp("undo_until", { withTimezone: true }),
    preparingStartedAt: timestamp("preparing_started_at", { withTimezone: true }).defaultNow().notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    failureCode: text("failure_code"),
    failureDetail: text("failure_detail"),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [
    index("outbound_transport_idx").on(t.transportStatus),
    index("outbound_account_idx").on(t.accountId),
    index("outbound_due_idx").on(t.transportStatus, t.nextAttemptAt),
    uniqueIndex("outbound_account_request_idx").on(t.accountId, t.clientRequestId),
  ],
);

export const outboundRecipients = pgTable(
  "outbound_recipients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    outboundMessageId: uuid("outbound_message_id")
      .notNull()
      .references(() => outboundMessages.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    recipientType: recipientType("recipient_type").notNull(),
    deliveryStatus: recipientDeliveryStatus("recipient_delivery_status").default("pending").notNull(),
    providerRecipientId: text("provider_recipient_id"),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("outbound_recipients_msg_email_idx").on(t.outboundMessageId, t.email),
    index("outbound_recipients_status_idx").on(t.deliveryStatus),
  ],
);

export const outboundAttachments = pgTable(
  "outbound_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    outboundMessageId: uuid("outbound_message_id")
      .notNull()
      .references(() => outboundMessages.id, { onDelete: "cascade" }),
    engineAttachmentId: text("engine_attachment_id"),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").default(0).notNull(),
    contentDisposition: text("content_disposition").default("attachment").notNull(),
    contentId: text("content_id"),
    ...timestamps,
  },
  (t) => [index("outbound_attachments_msg_idx").on(t.outboundMessageId)],
);

export const deliverySuppressions = pgTable(
  "delivery_suppressions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    reason: suppressionReason("suppression_reason").notNull(),
    source: text("source").notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("suppressions_org_email_idx").on(t.organizationId, t.email),
    index("suppressions_email_idx").on(t.email),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("audit_org_idx").on(t.organizationId),
    index("audit_action_idx").on(t.action),
    index("audit_created_idx").on(t.createdAt),
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

export const userSettings = pgTable(
  "user_settings",
  {
    userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
    general: jsonb("general").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    compose: jsonb("compose").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    contacts: jsonb("contacts").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    ...timestamps,
  },
);

export const emailSignatures = pgTable(
  "email_signatures",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    signatureHtml: text("signature_html").default("").notNull(),
    signatureText: text("signature_text").default("").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    onNew: boolean("on_new").default(true).notNull(),
    onReply: boolean("on_reply").default(true).notNull(),
    onForward: boolean("on_forward").default(true).notNull(),
    position: signaturePosition("signature_position").default("beforeQuotedText").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("email_signatures_user_idx").on(t.userId)],
);

export const contactImportBatches = pgTable(
  "contact_import_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: text("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    rowCount: integer("row_count").default(0).notNull(),
    createdCount: integer("created_count").default(0).notNull(),
    updatedCount: integer("updated_count").default(0).notNull(),
    skippedCount: integer("skipped_count").default(0).notNull(),
    duplicateCount: integer("duplicate_count").default(0).notNull(),
    failedCount: integer("failed_count").default(0).notNull(),
    ...timestamps,
  },
  (t) => [index("contact_import_batches_owner_idx").on(t.ownerUserId, t.createdAt)],
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: text("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    firstName: text("first_name"),
    middleName: text("middle_name"),
    lastName: text("last_name"),
    displayName: text("display_name"),
    organization: text("organization"),
    jobTitle: text("job_title"),
    website: text("website"),
    address: text("address"),
    city: text("city"),
    state: text("state"),
    postalCode: text("postal_code"),
    country: text("country"),
    notes: text("notes"),
    stalwartContactId: text("stalwart_contact_id"),
    stalwartAddressBookId: text("stalwart_address_book_id"),
    source: text("source").default("manual").notNull(),
    sourceFile: text("source_file"),
    importBatchId: uuid("import_batch_id").references(() => contactImportBatches.id, { onDelete: "set null" }),
    lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
    firstContactedAt: timestamp("first_contacted_at", { withTimezone: true }),
    timesEmailed: integer("times_emailed").default(0).notNull(),
    ...timestamps,
  },
  (t) => [index("contacts_owner_idx").on(t.ownerUserId), index("contacts_stalwart_idx").on(t.ownerUserId, t.stalwartContactId), index("contacts_search_idx").on(t.ownerUserId, t.displayName, t.organization)],
);

export const contactEmails = pgTable(
  "contact_emails",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    normalizedEmail: text("normalized_email").notNull(),
    label: text("label"),
    isPrimary: boolean("is_primary").default(false).notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("contact_emails_contact_normalized_idx").on(t.contactId, t.normalizedEmail), index("contact_emails_normalized_idx").on(t.normalizedEmail)],
);

export const contactPhones = pgTable(
  "contact_phones",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    phone: text("phone").notNull(),
    label: text("label"),
    isPrimary: boolean("is_primary").default(false).notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("contact_phones_contact_phone_idx").on(t.contactId, t.phone)],
);

export const contactTags = pgTable(
  "contact_tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
    normalizedTag: text("normalized_tag").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("contact_tags_contact_normalized_idx").on(t.contactId, t.normalizedTag), index("contact_tags_search_idx").on(t.normalizedTag)],
);

export const contactCustomFields = pgTable(
  "contact_custom_fields",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    fieldKey: text("field_key").notNull(),
    value: jsonb("value").$type<string | number | boolean | null>(),
    ...timestamps,
  },
  (t) => [uniqueIndex("contact_custom_fields_contact_key_idx").on(t.contactId, t.fieldKey)],
);

export const contactImportRows = pgTable(
  "contact_import_rows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    batchId: uuid("batch_id").notNull().references(() => contactImportBatches.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    raw: jsonb("raw").$type<Record<string, string>>().notNull(),
    status: text("status").notNull(),
    error: text("error"),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("contact_import_rows_batch_idx").on(t.batchId, t.rowNumber)],
);
