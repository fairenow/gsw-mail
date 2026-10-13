import { pool } from "../db/client.js";

/** Idempotent startup guard; migrations also contain the canonical table. */
export async function ensureFileOrganizationSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "file_organization_jobs" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "status" text NOT NULL DEFAULT 'queued',
      "plan_hash" text NOT NULL,
      "date_basis" text NOT NULL,
      "actions" jsonb NOT NULL,
      "cursor" integer NOT NULL DEFAULT 0,
      "moved_count" integer NOT NULL DEFAULT 0,
      "failed_count" integer NOT NULL DEFAULT 0,
      "errors" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "lease_until" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "file_organization_jobs_status_check" CHECK ("status" IN ('queued','running','paused','completed','completed_with_errors'))
    );
    CREATE INDEX IF NOT EXISTS "file_organization_jobs_status_idx" ON "file_organization_jobs" ("status","lease_until");
    CREATE INDEX IF NOT EXISTS "file_organization_jobs_user_idx" ON "file_organization_jobs" ("user_id","created_at");
  `);
}
