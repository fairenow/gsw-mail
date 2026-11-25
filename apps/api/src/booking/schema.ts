import { pool } from "../db/client.js";
export const EVENT_LINK_SCHEMA = `
CREATE TABLE IF NOT EXISTS event_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, auth_user_id text NOT NULL, slug text NOT NULL UNIQUE CHECK(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 settings jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_links_account_idx ON event_links(account_id);
CREATE TABLE IF NOT EXISTS event_bookings (
 id uuid PRIMARY KEY, link_id uuid NOT NULL REFERENCES event_links(id) ON DELETE CASCADE,account_id uuid NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
 request_id uuid NOT NULL, payload_hash text NOT NULL, settings jsonb NOT NULL,
 name text NOT NULL,email text NOT NULL,phone text NOT NULL,message text NOT NULL,
 starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL CHECK(ends_at>starts_at),
 status text NOT NULL CHECK(status IN ('pending','approved','creating','confirmed','declined','expired','attention')),
 hold_until timestamptz NOT NULL,event_id text,meeting_url text,claimed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(link_id,request_id)
);
ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS community_verified boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS event_bookings_calendar_idx ON event_bookings(account_id,starts_at,ends_at);
CREATE INDEX IF NOT EXISTS event_bookings_work_idx ON event_bookings(status,created_at);
CREATE TABLE IF NOT EXISTS event_booking_mail (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),booking_id uuid NOT NULL REFERENCES event_bookings(id) ON DELETE CASCADE,
 notification_key text NOT NULL UNIQUE,recipient text NOT NULL,subject text NOT NULL,body text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','queued','attention')),
 send_id uuid,claimed_at timestamptz,attempts integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now()
);
`;
export async function ensureEventLinkSchema() {
  await pool.query(EVENT_LINK_SCHEMA);
}
