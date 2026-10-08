CREATE TABLE IF NOT EXISTS "ai_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "account_id" uuid REFERENCES "email_accounts"("id") ON DELETE SET NULL,
  "conversation_id" uuid REFERENCES "ai_conversations"("id") ON DELETE SET NULL,
  "title" text NOT NULL,
  "instruction" text NOT NULL,
  "status" text DEFAULT 'planned' NOT NULL,
  "worker" text DEFAULT 'coordinator' NOT NULL,
  "selected_skills" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "current_step" integer DEFAULT 0 NOT NULL,
  "progress_percent" integer DEFAULT 0 NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ai_tasks_user_idx" ON "ai_tasks" ("user_id", "status", "updated_at");
CREATE INDEX IF NOT EXISTS "ai_tasks_conversation_idx" ON "ai_tasks" ("conversation_id", "updated_at");
CREATE INDEX IF NOT EXISTS "ai_tasks_account_idx" ON "ai_tasks" ("account_id", "status");

CREATE TABLE IF NOT EXISTS "ai_task_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid NOT NULL REFERENCES "ai_tasks"("id") ON DELETE CASCADE,
  "sequence" integer NOT NULL,
  "title" text NOT NULL,
  "worker" text DEFAULT 'coordinator' NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "input" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "result" jsonb,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_task_steps_task_sequence_idx" ON "ai_task_steps" ("task_id", "sequence");
CREATE INDEX IF NOT EXISTS "ai_task_steps_status_idx" ON "ai_task_steps" ("task_id", "status");
