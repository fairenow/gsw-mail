CREATE TABLE IF NOT EXISTS "integration_webhook_endpoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "installation_id" uuid NOT NULL REFERENCES "integration_installations"("id") ON DELETE cascade,
  "url" text NOT NULL,
  "secret_encrypted" text NOT NULL,
  "secret_prefix" text NOT NULL,
  "events" jsonb NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "failure_count" integer DEFAULT 0 NOT NULL,
  "last_success_at" timestamptz,
  "last_failure_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "integration_webhook_endpoints_installation_idx" ON "integration_webhook_endpoints"("installation_id");

CREATE TABLE IF NOT EXISTS "integration_webhook_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "installation_id" uuid NOT NULL REFERENCES "integration_installations"("id") ON DELETE restrict,
  "type" text NOT NULL,
  "dedupe_key" text NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "integration_webhook_events_dedupe_idx" ON "integration_webhook_events"("installation_id", "dedupe_key");
CREATE INDEX IF NOT EXISTS "integration_webhook_events_installation_idx" ON "integration_webhook_events"("installation_id", "created_at");

CREATE TABLE IF NOT EXISTS "integration_webhook_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "endpoint_id" uuid NOT NULL REFERENCES "integration_webhook_endpoints"("id") ON DELETE cascade,
  "event_id" uuid NOT NULL REFERENCES "integration_webhook_events"("id") ON DELETE cascade,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamptz DEFAULT now() NOT NULL,
  "last_status" integer,
  "last_error" text,
  "delivered_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "integration_webhook_deliveries_endpoint_event_idx" ON "integration_webhook_deliveries"("endpoint_id", "event_id");
CREATE INDEX IF NOT EXISTS "integration_webhook_deliveries_due_idx" ON "integration_webhook_deliveries"("status", "next_attempt_at");
