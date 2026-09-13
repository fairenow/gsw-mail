ALTER TABLE "outbound_messages" ADD COLUMN IF NOT EXISTS "template_key" text DEFAULT 'gsw_default' NOT NULL;
