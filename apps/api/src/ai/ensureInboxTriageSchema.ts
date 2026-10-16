import { pool } from "../db/client.js";

/** Idempotent production bootstrap for the triage-specific tables.
 * Compatible with migrations 0031–0033; never drops scan data.
 */
export async function ensureInboxTriageSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_inbox_triage_snapshots (
      user_id text NOT NULL,
      account_id text NOT NULL,
      report jsonb NOT NULL,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, account_id)
    );
    CREATE INDEX IF NOT EXISTS ai_inbox_triage_snapshots_expires_idx
      ON ai_inbox_triage_snapshots(expires_at);
    CREATE TABLE IF NOT EXISTS ai_inbox_triage_progress (
      user_id text NOT NULL,
      account_id text NOT NULL,
      state jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(user_id,account_id)
    );
    CREATE INDEX IF NOT EXISTS ai_inbox_triage_progress_updated_idx
      ON ai_inbox_triage_progress(updated_at);
    CREATE TABLE IF NOT EXISTS ai_inbox_triage_verdicts (
      user_id text NOT NULL,
      account_id text NOT NULL,
      thread_id text NOT NULL,
      scan_expires_at timestamptz NOT NULL,
      verdict jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(user_id,account_id,thread_id)
    );
    CREATE INDEX IF NOT EXISTS ai_inbox_triage_verdicts_expiry_idx
      ON ai_inbox_triage_verdicts(scan_expires_at);
  `);
}

/** Read-only diagnostics; query existing objects instead of inferring readiness
 * from a successful HTTP or OAuth session alone. */
export async function inboxTriageSchemaHealth() {
  const { rows } = await pool.query<{
    snapshots: string | null; progress: string | null; verdicts: string | null;
  }>(`SELECT to_regclass('public.ai_inbox_triage_snapshots')::text AS snapshots,
    to_regclass('public.ai_inbox_triage_progress')::text AS progress,
    to_regclass('public.ai_inbox_triage_verdicts')::text AS verdicts`);
  return Boolean(rows[0]?.snapshots && rows[0]?.progress && rows[0]?.verdicts);
}
