CREATE TABLE IF NOT EXISTS "ai_idempotency_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "account_id" uuid REFERENCES "email_accounts"("id") ON DELETE CASCADE,
  "tool_call_id" uuid REFERENCES "ai_tool_calls"("id") ON DELETE CASCADE,
  "tool_name" text NOT NULL,
  "status" text DEFAULT 'reserved' NOT NULL,
  "result" jsonb,
  "error_code" text,
  "error_message" text,
  "expires_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_idempotency_keys_key_idx" ON "ai_idempotency_keys" ("key");
CREATE UNIQUE INDEX IF NOT EXISTS "ai_idempotency_keys_tool_call_idx" ON "ai_idempotency_keys" ("tool_call_id");
CREATE INDEX IF NOT EXISTS "ai_idempotency_keys_user_idx" ON "ai_idempotency_keys" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "ai_idempotency_keys_status_idx" ON "ai_idempotency_keys" ("status", "created_at");
