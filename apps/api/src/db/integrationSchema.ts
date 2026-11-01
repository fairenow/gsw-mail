import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { emailAccounts, organizations, outboundMessages, users } from "./schema.js";

export const integrationInstallations = pgTable("integration_installations", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => emailAccounts.id, { onDelete: "restrict" }),
  authorizedBy: text("authorized_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  active: boolean("active").default(true).notNull(),
  testMode: boolean("test_mode").default(false).notNull(),
  allowedRecipients: jsonb("allowed_recipients").$type<string[]>().notNull(),
  dailyLimit: integer("daily_limit").default(100).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, t => [index("integration_installations_org_idx").on(t.organizationId), check("integration_installations_daily_limit_check", sql`${t.dailyLimit} BETWEEN 1 AND 1000`)]);

export const integrationKeys = pgTable("integration_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  installationId: uuid("installation_id").notNull().references(() => integrationInstallations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  scopes: jsonb("scopes").$type<string[]>().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [uniqueIndex("integration_keys_hash_idx").on(t.keyHash), index("integration_keys_installation_idx").on(t.installationId)]);

export const integrationEmails = pgTable("integration_emails", {
  id: uuid("id").defaultRandom().primaryKey(),
  installationId: uuid("installation_id").notNull().references(() => integrationInstallations.id, { onDelete: "restrict" }),
  keyId: uuid("key_id").notNull().references(() => integrationKeys.id, { onDelete: "restrict" }),
  outboundMessageId: uuid("outbound_message_id").references(() => outboundMessages.id, { onDelete: "restrict" }),
  idempotencyKey: text("idempotency_key").notNull(),
  fingerprint: text("fingerprint").notNull(),
  testMode: boolean("test_mode").notNull(),
  metadata: jsonb("metadata").$type<Record<string, string>>().default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [uniqueIndex("integration_emails_idempotency_idx").on(t.installationId, t.idempotencyKey), uniqueIndex("integration_emails_outbound_idx").on(t.outboundMessageId), index("integration_emails_usage_idx").on(t.installationId, t.createdAt)]);


export const integrationWebhookEndpoints = pgTable("integration_webhook_endpoints", {
  id: uuid("id").defaultRandom().primaryKey(),
  installationId: uuid("installation_id").notNull().references(() => integrationInstallations.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  secretEncrypted: text("secret_encrypted").notNull(),
  secretPrefix: text("secret_prefix").notNull(),
  events: jsonb("events").$type<string[]>().notNull(),
  active: boolean("active").default(true).notNull(),
  failureCount: integer("failure_count").default(0).notNull(),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [index("integration_webhook_endpoints_installation_idx").on(t.installationId)]);

export const integrationWebhookEvents = pgTable("integration_webhook_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  installationId: uuid("installation_id").notNull().references(() => integrationInstallations.id, { onDelete: "restrict" }),
  type: text("type").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  uniqueIndex("integration_webhook_events_dedupe_idx").on(t.installationId, t.dedupeKey),
  index("integration_webhook_events_installation_idx").on(t.installationId, t.createdAt),
]);

export const integrationWebhookDeliveries = pgTable("integration_webhook_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  endpointId: uuid("endpoint_id").notNull().references(() => integrationWebhookEndpoints.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").notNull().references(() => integrationWebhookEvents.id, { onDelete: "cascade" }),
  status: text("status").default("pending").notNull(),
  attempts: integer("attempts").default(0).notNull(),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow().notNull(),
  processingAt: timestamp("processing_at", { withTimezone: true }),
  lastStatus: integer("last_status"),
  lastError: text("last_error"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  uniqueIndex("integration_webhook_deliveries_endpoint_event_idx").on(t.endpointId, t.eventId),
  index("integration_webhook_deliveries_due_idx").on(t.status, t.nextAttemptAt),
]);
