import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { domains } from "./schema.js";

export type DomainDnsRecord = {
  source: "stalwart" | "resend" | "gsw";
  type: "MX" | "TXT" | "CNAME";
  name: string;
  value: string;
  priority?: number;
  purpose: "mx" | "spf" | "dkim" | "dmarc" | "other";
  required: boolean;
};

export type ObservedDnsRecord = DomainDnsRecord & {
  matches: boolean;
  observed: string[];
};

export const domainDnsState = pgTable("domain_dns_state", {
  domainId: uuid("domain_id")
    .primaryKey()
    .references(() => domains.id, { onDelete: "cascade" }),
  stalwartDomainId: text("stalwart_domain_id"),
  stalwartDnsZoneFile: text("stalwart_dns_zone_file"),
  resendDomainId: text("resend_domain_id"),
  expectedRecords: jsonb("expected_records").$type<DomainDnsRecord[]>().default([]).notNull(),
  observedRecords: jsonb("observed_records").$type<ObservedDnsRecord[]>().default([]).notNull(),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  lastHealthyAt: timestamp("last_healthy_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
