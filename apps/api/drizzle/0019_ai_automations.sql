CREATE TABLE IF NOT EXISTS "ai_automations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "account_id" uuid REFERENCES "email_accounts"("id") ON DELETE SET NULL,
  "conversation_id" uuid REFERENCES "ai_conversations"("id") ON DELETE SET NULL,
  "title" text NOT NULL,
  "instruction" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "time_zone" text NOT NULL,
  "schedule" jsonb NOT NULL,
  "allowed_scopes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "next_run_at" timestamp with time zone NOT NULL,
  "last_run_at" timestamp with time zone,
  "running_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "ai_automations_user_idx" ON "ai_automations" ("user_id", "status", "next_run_at");
CREATE INDEX IF NOT EXISTS "ai_automations_due_idx" ON "ai_automations" ("status", "next_run_at");
CREATE INDEX IF NOT EXISTS "ai_automations_account_idx" ON "ai_automations" ("account_id", "status");

CREATE TABLE IF NOT EXISTS "ai_automation_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "automation_id" uuid NOT NULL REFERENCES "ai_automations"("id") ON DELETE CASCADE,
  "conversation_id" uuid REFERENCES "ai_conversations"("id") ON DELETE SET NULL,
  "status" text DEFAULT 'running' NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "result" text,
  "error_message" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "ai_automation_runs_automation_idx" ON "ai_automation_runs" ("automation_id", "started_at");
CREATE INDEX IF NOT EXISTS "ai_automation_runs_status_idx" ON "ai_automation_runs" ("status", "started_at");
