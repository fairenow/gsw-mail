ALTER TABLE "users" ADD COLUMN "auth_user_id" text;
--> statement-breakpoint
ALTER TABLE "email_accounts" ADD COLUMN "workspace_id" uuid;
--> statement-breakpoint
ALTER TABLE "email_accounts" ADD COLUMN "stalwart_principal_id" text;
--> statement-breakpoint
ALTER TABLE "mail_account_memberships" ADD COLUMN "auth_user_id" text;
--> statement-breakpoint
UPDATE "email_accounts" AS a SET "workspace_id" = d."organization_id"
FROM "domains" AS d WHERE d."id" = a."domain_id";
--> statement-breakpoint
ALTER TABLE "email_accounts" ALTER COLUMN "workspace_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_id_workspace_unique" UNIQUE ("id", "organization_id");
--> statement-breakpoint
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "organizations"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_domain_workspace_fk" FOREIGN KEY ("domain_id", "workspace_id") REFERENCES "domains"("id", "organization_id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_auth_user_fk" FOREIGN KEY ("auth_user_id") REFERENCES "auth_users"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "mail_account_memberships" ADD CONSTRAINT "mail_account_memberships_auth_user_fk" FOREIGN KEY ("auth_user_id") REFERENCES "auth_users"("id") ON DELETE set null;
--> statement-breakpoint
CREATE UNIQUE INDEX "users_auth_user_idx" ON "users" USING btree ("auth_user_id");
--> statement-breakpoint
CREATE INDEX "email_accounts_workspace_idx" ON "email_accounts" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX "account_memberships_auth_user_idx" ON "mail_account_memberships" USING btree ("auth_user_id");
