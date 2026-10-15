-- Scoped, expiring mailbox triage snapshots. Contains mailbox-derived metadata;
-- never store access tokens, cookies, or authorization headers.
CREATE TABLE IF NOT EXISTS ai_inbox_triage_snapshots (
  user_id text NOT NULL,
  account_id text NOT NULL,
  report jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, account_id)
);
CREATE INDEX IF NOT EXISTS ai_inbox_triage_snapshots_expires_idx ON ai_inbox_triage_snapshots (expires_at);
