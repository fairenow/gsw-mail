CREATE TABLE IF NOT EXISTS "jwks" (
  "id" text PRIMARY KEY NOT NULL,
  "public_key" text NOT NULL,
  "private_key" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_client" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL UNIQUE,
  "client_secret" text,
  "disabled" boolean DEFAULT false,
  "skip_consent" boolean,
  "enable_end_session" boolean,
  "subject_type" text,
  "scopes" text[],
  "user_id" text REFERENCES "auth_users"("id") ON DELETE cascade,
  "created_at" timestamp with time zone,
  "updated_at" timestamp with time zone,
  "name" text,
  "uri" text,
  "icon" text,
  "contacts" text[],
  "tos" text,
  "policy" text,
  "software_id" text,
  "software_version" text,
  "software_statement" text,
  "redirect_uris" text[] NOT NULL,
  "post_logout_redirect_uris" text[],
  "token_endpoint_auth_method" text,
  "grant_types" text[],
  "response_types" text[],
  "public" boolean,
  "type" text,
  "require_pkce" boolean,
  "reference_id" text,
  "metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_refresh_token" (
  "id" text PRIMARY KEY NOT NULL,
  "token" text NOT NULL,
  "client_id" text NOT NULL REFERENCES "oauth_client"("client_id") ON DELETE cascade,
  "session_id" text REFERENCES "auth_sessions"("id") ON DELETE set null,
  "user_id" text NOT NULL REFERENCES "auth_users"("id") ON DELETE cascade,
  "reference_id" text,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "revoked" timestamp with time zone,
  "auth_time" timestamp with time zone,
  "scopes" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_access_token" (
  "id" text PRIMARY KEY NOT NULL,
  "token" text NOT NULL UNIQUE,
  "client_id" text NOT NULL REFERENCES "oauth_client"("client_id") ON DELETE cascade,
  "session_id" text REFERENCES "auth_sessions"("id") ON DELETE set null,
  "user_id" text REFERENCES "auth_users"("id") ON DELETE cascade,
  "reference_id" text,
  "refresh_id" text REFERENCES "oauth_refresh_token"("id") ON DELETE cascade,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "scopes" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_consent" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL REFERENCES "oauth_client"("client_id") ON DELETE cascade,
  "user_id" text REFERENCES "auth_users"("id") ON DELETE cascade,
  "reference_id" text,
  "scopes" text[] NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);
