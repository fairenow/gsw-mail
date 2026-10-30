CREATE TABLE "integration_installations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "account_id" uuid NOT NULL REFERENCES "email_accounts"("id") ON DELETE restrict,
  "authorized_by" text NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "name" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "test_mode" boolean DEFAULT true NOT NULL,
  "allowed_recipients" jsonb NOT NULL,
  "daily_limit" integer DEFAULT 100 NOT NULL CHECK ("daily_limit" BETWEEN 1 AND 1000),
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "integration_installations_org_idx" ON "integration_installations"("organization_id");
--> statement-breakpoint
CREATE TABLE "integration_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "installation_id" uuid NOT NULL REFERENCES "integration_installations"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "key_hash" text NOT NULL,
  "key_prefix" text NOT NULL,
  "scopes" jsonb NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "integration_keys_hash_idx" ON "integration_keys"("key_hash");
CREATE INDEX "integration_keys_installation_idx" ON "integration_keys"("installation_id");
--> statement-breakpoint
CREATE TABLE "integration_emails" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "installation_id" uuid NOT NULL REFERENCES "integration_installations"("id") ON DELETE restrict,
  "key_id" uuid NOT NULL REFERENCES "integration_keys"("id") ON DELETE restrict,
  "outbound_message_id" uuid REFERENCES "outbound_messages"("id") ON DELETE restrict,
  "idempotency_key" text NOT NULL,
  "fingerprint" text NOT NULL,
  "test_mode" boolean NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "integration_emails_idempotency_idx" ON "integration_emails"("installation_id", "idempotency_key");
CREATE UNIQUE INDEX "integration_emails_outbound_idx" ON "integration_emails"("outbound_message_id");
CREATE INDEX "integration_emails_usage_idx" ON "integration_emails"("installation_id", "created_at");
