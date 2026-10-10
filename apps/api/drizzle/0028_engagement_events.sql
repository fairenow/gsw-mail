CREATE TABLE IF NOT EXISTS engagement_events (
 id uuid PRIMARY KEY,
 event_type text NOT NULL CHECK (event_type IN ('page_view','click','scroll_depth','page_exit','visibility','web_vital')),
 path varchar(160) NOT NULL,
 session_id uuid NOT NULL,
 visitor_id uuid NOT NULL,
 occurred_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS engagement_events_occurred_idx ON engagement_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS engagement_events_type_path_idx ON engagement_events (event_type,path,occurred_at DESC);
CREATE INDEX IF NOT EXISTS engagement_events_session_idx ON engagement_events (session_id,occurred_at DESC);
