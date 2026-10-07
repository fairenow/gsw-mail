DO $$ BEGIN
  CREATE TYPE "calendar_rsvp_response" AS ENUM ('accepted', 'declined', 'tentative');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "calendar_rsvps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "email_accounts"("id") ON DELETE CASCADE,
  "event_id" text NOT NULL,
  "attendee_email" text NOT NULL,
  "event_title" text NOT NULL,
  "event_start" timestamp with time zone NOT NULL,
  "event_end" timestamp with time zone,
  "event_location" text,
  "meeting_link" text,
  "response" "calendar_rsvp_response",
  "responded_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "calendar_rsvps_event_attendee_idx" ON "calendar_rsvps" ("account_id", "event_id", "attendee_email");
CREATE INDEX IF NOT EXISTS "calendar_rsvps_event_idx" ON "calendar_rsvps" ("account_id", "event_id");
