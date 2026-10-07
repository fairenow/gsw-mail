CREATE TABLE IF NOT EXISTS "ai_campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "account_id" uuid NOT NULL REFERENCES "email_accounts"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "subject" text NOT NULL,
  "text_body" text,
  "html_body" text,
  "audience_tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "recipient_count" integer DEFAULT 0 NOT NULL,
  "launched_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "ai_campaigns_user_idx" ON "ai_campaigns" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "ai_campaigns_account_idx" ON "ai_campaigns" ("account_id", "status");

CREATE TABLE IF NOT EXISTS "ai_campaign_recipients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL REFERENCES "ai_campaigns"("id") ON DELETE CASCADE,
  "contact_id" uuid REFERENCES "contacts"("id") ON DELETE SET NULL,
  "email" text NOT NULL,
  "display_name" text,
  "first_name" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "send_id" uuid REFERENCES "outbound_messages"("id") ON DELETE SET NULL,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_campaign_recipients_unique_idx" ON "ai_campaign_recipients" ("campaign_id", "email");
CREATE INDEX IF NOT EXISTS "ai_campaign_recipients_campaign_idx" ON "ai_campaign_recipients" ("campaign_id", "status");
