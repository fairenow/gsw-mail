CREATE TABLE IF NOT EXISTS ai_inbox_triage_verdicts (
 user_id text NOT NULL, account_id text NOT NULL, thread_id text NOT NULL,
 scan_expires_at timestamptz NOT NULL, verdict jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,account_id,thread_id)
);
CREATE INDEX IF NOT EXISTS ai_inbox_triage_verdicts_expiry_idx ON ai_inbox_triage_verdicts(scan_expires_at);
