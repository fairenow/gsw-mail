import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { outboundMessages, users } from "../db/schema.js";

export type RecurrenceRule = {
  frequency: "daily" | "weekdays" | "weekly" | "monthly";
  interval: number;
  endAt?: string | undefined;
  maxOccurrences?: number | undefined;
};

export const scheduledSends = pgTable(
  "scheduled_sends",
  {
    outboundMessageId: uuid("outbound_message_id")
      .primaryKey()
      .references(() => outboundMessages.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"once" | "recurring">().notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    timeZone: text("time_zone").notNull(),
    recurrence: jsonb("recurrence").$type<RecurrenceRule>(),
    seriesId: uuid("series_id").notNull(),
    occurrenceIndex: integer("occurrence_index").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("scheduled_sends_due_idx").on(t.scheduledFor),
    index("scheduled_sends_series_idx").on(t.seriesId, t.occurrenceIndex),
    index("scheduled_sends_user_idx").on(t.userId),
  ],
);
