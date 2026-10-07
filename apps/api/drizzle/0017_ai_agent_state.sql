CREATE TABLE IF NOT EXISTS "ai_conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "account_id" uuid REFERENCES "email_accounts"("id") ON DELETE SET NULL,
  "workspace_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL,
  "title" text,
  "status" text DEFAULT 'active' NOT NULL,
  "last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ai_conversations_user_idx" ON "ai_conversations" ("user_id", "last_message_at");
CREATE INDEX IF NOT EXISTS "ai_conversations_account_idx" ON "ai_conversations" ("account_id", "last_message_at");

CREATE TABLE IF NOT EXISTS "ai_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "conversation_id" uuid NOT NULL REFERENCES "ai_conversations"("id") ON DELETE CASCADE,
  "role" text NOT NULL,
  "content" text NOT NULL,
  "provider" text,
  "model" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ai_messages_conversation_idx" ON "ai_messages" ("conversation_id", "created_at");

CREATE TABLE IF NOT EXISTS "ai_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "conversation_id" uuid NOT NULL REFERENCES "ai_conversations"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "account_id" uuid REFERENCES "email_accounts"("id") ON DELETE SET NULL,
  "provider" text NOT NULL,
  "model" text,
  "status" text DEFAULT 'running' NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "error_code" text,
  "error_message" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ai_runs_conversation_idx" ON "ai_runs" ("conversation_id", "started_at");
CREATE INDEX IF NOT EXISTS "ai_runs_user_idx" ON "ai_runs" ("user_id", "started_at");

CREATE TABLE IF NOT EXISTS "ai_tool_calls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL REFERENCES "ai_runs"("id") ON DELETE CASCADE,
  "conversation_id" uuid NOT NULL REFERENCES "ai_conversations"("id") ON DELETE CASCADE,
  "provider_tool_call_id" text NOT NULL,
  "tool_name" text NOT NULL,
  "risk" text NOT NULL,
  "required_scopes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "arguments" jsonb,
  "status" text DEFAULT 'requested' NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_tool_calls_provider_idx" ON "ai_tool_calls" ("run_id", "provider_tool_call_id");
CREATE INDEX IF NOT EXISTS "ai_tool_calls_run_idx" ON "ai_tool_calls" ("run_id", "created_at");
CREATE INDEX IF NOT EXISTS "ai_tool_calls_conversation_idx" ON "ai_tool_calls" ("conversation_id", "created_at");

CREATE TABLE IF NOT EXISTS "ai_tool_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tool_call_id" uuid NOT NULL REFERENCES "ai_tool_calls"("id") ON DELETE CASCADE,
  "ok" boolean NOT NULL,
  "result" jsonb,
  "error_code" text,
  "error_message" text,
  "retryable" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_tool_results_call_idx" ON "ai_tool_results" ("tool_call_id");

CREATE TABLE IF NOT EXISTS "ai_permission_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "account_id" uuid REFERENCES "email_accounts"("id") ON DELETE CASCADE,
  "workspace_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE,
  "scope" text NOT NULL,
  "source" text DEFAULT 'user' NOT NULL,
  "granted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ai_permission_grants_user_idx" ON "ai_permission_grants" ("user_id", "scope");
CREATE INDEX IF NOT EXISTS "ai_permission_grants_account_idx" ON "ai_permission_grants" ("account_id", "scope");

CREATE TABLE IF NOT EXISTS "ai_confirmations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "conversation_id" uuid NOT NULL REFERENCES "ai_conversations"("id") ON DELETE CASCADE,
  "run_id" uuid REFERENCES "ai_runs"("id") ON DELETE CASCADE,
  "tool_call_id" uuid REFERENCES "ai_tool_calls"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "action" text NOT NULL,
  "summary" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "decided_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ai_confirmations_user_idx" ON "ai_confirmations" ("user_id", "status", "requested_at");
CREATE INDEX IF NOT EXISTS "ai_confirmations_conversation_idx" ON "ai_confirmations" ("conversation_id", "requested_at");
