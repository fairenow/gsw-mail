CREATE TABLE IF NOT EXISTS ai_inbox_triage_progress (
  user_id text NOT NULL,
  account_id text NOT NULL,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,account_id)
);
CREATE INDEX IF NOT EXISTS ai_inbox_triage_progress_updated_idx ON ai_inbox_triage_progress(updated_at);
