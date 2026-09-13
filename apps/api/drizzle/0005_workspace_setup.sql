CREATE TYPE "public"."setup_step" AS ENUM('email_verified', 'workspace_created', 'domain_added', 'domain_verified', 'first_mailbox_created', 'complete');--> statement-breakpoint
CREATE TABLE "workspace_setup_states" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"current_step" "setup_step" DEFAULT 'email_verified' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_setup_states" ADD CONSTRAINT "workspace_setup_states_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
