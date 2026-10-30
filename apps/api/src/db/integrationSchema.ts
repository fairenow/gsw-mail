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
  testMode: boolean("test_mode").default(true).notNull(),
  allowedRecipients: jsonb("allowed_recipients").$type<string[]>().notNull(),
  dailyLimit: integer("daily_limit").default(100).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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
