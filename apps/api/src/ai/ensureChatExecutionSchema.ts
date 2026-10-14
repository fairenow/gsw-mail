import { pool } from "../db/client.js";

/** Idempotent bootstrap for the chat execution queue in the existing Railway API. */
export async function ensureChatExecutionSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS ai_chat_executions (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  account_id uuid,
  command_id uuid NOT NULL,
  conversation_id uuid,
  request jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','uncertain','failed')),
  attempts integer NOT NULL DEFAULT 0,
  lease_owner text,
  lease_expires_at timestamptz,
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (user_id, command_id)
);
CREATE INDEX IF NOT EXISTS ai_chat_executions_claim_idx
  ON ai_chat_executions (status, lease_expires_at, created_at);
`);
}
