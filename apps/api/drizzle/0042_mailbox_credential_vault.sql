CREATE TABLE IF NOT EXISTS mailbox_credential_vault (
  account_id uuid PRIMARY KEY REFERENCES email_accounts(id) ON DELETE CASCADE,
  auth_user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  client_id text NOT NULL REFERENCES oauth_client(client_id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL,
  encrypted_access_token text NOT NULL,
  encrypted_refresh_token text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
