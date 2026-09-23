CREATE TABLE IF NOT EXISTS "outbound_attachment_payloads" (
  "outbound_message_id" uuid NOT NULL REFERENCES "outbound_messages"("id") ON DELETE CASCADE,
  "position" integer NOT NULL,
  "filename" text NOT NULL,
  "content_type" text NOT NULL,
  "content_id" text,
  "content_base64" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("outbound_message_id", "position")
);
