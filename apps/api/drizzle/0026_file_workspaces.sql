CREATE TABLE IF NOT EXISTS "file_workspaces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "conversation_id" uuid NOT NULL REFERENCES "ai_conversations"("id") ON DELETE CASCADE,
  "provider" text DEFAULT 'openai' NOT NULL,
  "external_container_id" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "memory_limit" text DEFAULT '4g' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "file_workspaces_user_conversation_idx"
  ON "file_workspaces" USING btree ("user_id","conversation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_workspaces_expires_idx"
  ON "file_workspaces" USING btree ("expires_at");