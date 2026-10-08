ALTER TABLE "ai_tasks"
  ADD COLUMN IF NOT EXISTS "running_at" timestamp with time zone;

ALTER TABLE "ai_task_steps"
  ADD COLUMN IF NOT EXISTS "attempts" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "max_attempts" integer DEFAULT 3 NOT NULL,
  ADD COLUMN IF NOT EXISTS "next_attempt_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "last_error" text;

CREATE INDEX IF NOT EXISTS "ai_tasks_running_idx" ON "ai_tasks" ("status", "running_at", "updated_at");
CREATE INDEX IF NOT EXISTS "ai_task_steps_retry_idx" ON "ai_task_steps" ("task_id", "status", "next_attempt_at");
