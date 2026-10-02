import { pool } from "../db/client.js";

export async function ensureScheduledSendSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "scheduled_sends" (
      "outbound_message_id" uuid PRIMARY KEY NOT NULL REFERENCES "outbound_messages"("id") ON DELETE CASCADE,
      "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "kind" text NOT NULL,
      "scheduled_for" timestamp with time zone NOT NULL,
      "time_zone" text NOT NULL,
      "recurrence" jsonb,
      "series_id" uuid NOT NULL,
      "occurrence_index" integer DEFAULT 0 NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "scheduled_sends_due_idx" ON "scheduled_sends" ("scheduled_for");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "scheduled_sends_series_idx" ON "scheduled_sends" ("series_id", "occurrence_index");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "scheduled_sends_user_idx" ON "scheduled_sends" ("user_id");`);
}
