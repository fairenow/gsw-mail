-- Encrypted, short-lived MCP action payloads. No execution enabled by this table.
CREATE TABLE IF NOT EXISTS "mcp_action_payloads" (
  "approval_id" uuid PRIMARY KEY REFERENCES "mcp_action_approvals"("id") ON DELETE CASCADE,
  "version" integer NOT NULL DEFAULT 1 CHECK ("version" = 1),
  "nonce" text NOT NULL CHECK (length("nonce") BETWEEN 16 AND 32),
  "ciphertext" text NOT NULL CHECK (length("ciphertext") BETWEEN 1 AND 1500000),
  "auth_tag" text NOT NULL CHECK (length("auth_tag") BETWEEN 20 AND 32),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
