CREATE TYPE "public"."auth_setup_status" AS ENUM('pending', 'ready');
--> statement-breakpoint
ALTER TABLE "email_accounts" ADD COLUMN "auth_setup_status" "auth_setup_status" DEFAULT 'pending' NOT NULL;
