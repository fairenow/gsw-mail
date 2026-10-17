-- Phase 2 MCP write approval ledger. No write execution is enabled by this migration.
CREATE TABLE IF NOT EXISTS "mcp_action_approvals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "account_id" uuid NOT NULL REFERENCES "email_accounts"("id") ON DELETE CASCADE,
  "client_id" text NOT NULL,
  "tool_name" text NOT NULL,
  "arguments_digest" text NOT NULL,
  "summary" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending'
    CHECK ("status" IN ('pending','approved','rejected','revoked','consumed')),
  "expires_at" timestamptz NOT NULL,
  "decided_at" timestamptz,
  "consumed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "mcp_action_approvals_digest_chk"
    CHECK ("arguments_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "mcp_action_approvals_client_chk"
    CHECK (length("client_id") BETWEEN 1 AND 256),
  CONSTRAINT "mcp_action_approvals_tool_chk"
    CHECK (length("tool_name") BETWEEN 1 AND 256),
  CONSTRAINT "mcp_action_approvals_summary_chk"
    CHECK (length("summary") BETWEEN 1 AND 1000)
);
CREATE INDEX IF NOT EXISTS "mcp_action_approvals_owner_idx"
  ON "mcp_action_approvals" ("user_id","status","created_at");
CREATE INDEX IF NOT EXISTS "mcp_action_approvals_expiry_idx"
  ON "mcp_action_approvals" ("expires_at");
