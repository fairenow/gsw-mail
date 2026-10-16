import { pool } from "../db/client.js";

/** Idempotent database setup for the anonymous Prompting app quota. */
export async function ensurePromptingQuotaSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS prompting_hourly_quota (
      identity_hash text NOT NULL,
      hour_start timestamptz NOT NULL,
      used integer NOT NULL DEFAULT 0 CHECK (used BETWEEN 0 AND 3),
      PRIMARY KEY (identity_hash, hour_start)
    );
    CREATE INDEX IF NOT EXISTS prompting_hourly_quota_expiry_idx
      ON prompting_hourly_quota (hour_start);
  `);
}
