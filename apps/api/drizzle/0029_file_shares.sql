CREATE TABLE IF NOT EXISTS "file_shares" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "asset_id" uuid NOT NULL REFERENCES "assets"("id") ON DELETE cascade,
  "scope" text NOT NULL,
  "recipient_email" text,
  "token_hash" text,
  "permission" text NOT NULL DEFAULT 'viewer',
  "expires_at" timestamptz,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "file_shares_scope_check" CHECK (
    ("scope" = 'anyone' AND "recipient_email" IS NULL AND "token_hash" IS NOT NULL)
    OR ("scope" = 'email' AND "recipient_email" IS NOT NULL AND "token_hash" IS NULL)
  ),
  CONSTRAINT "file_shares_view_only" CHECK ("permission" = 'viewer')
);
CREATE INDEX IF NOT EXISTS "file_shares_owner_asset_idx" ON "file_shares" ("owner_user_id", "asset_id");
CREATE INDEX IF NOT EXISTS "file_shares_recipient_idx" ON "file_shares" ("recipient_email");
CREATE UNIQUE INDEX IF NOT EXISTS "file_shares_token_hash_idx" ON "file_shares" ("token_hash");