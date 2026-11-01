ALTER TABLE "integration_installations" ALTER COLUMN "test_mode" SET DEFAULT false;
ALTER TABLE "integration_installations" ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;
DELETE FROM "oauth_client" WHERE "client_id" = 'gsw-mail-web-oauth-test';
