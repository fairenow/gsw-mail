ALTER TABLE "integration_installations" ALTER COLUMN "test_mode" SET DEFAULT false;
DELETE FROM "oauth_client" WHERE "client_id" = 'gsw-mail-web-oauth-test';
