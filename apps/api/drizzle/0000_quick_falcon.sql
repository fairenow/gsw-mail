CREATE TYPE "public"."account_membership_role" AS ENUM('owner', 'delegate', 'read_only');--> statement-breakpoint
CREATE TYPE "public"."account_status" AS ENUM('pending', 'active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."alias_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."delivery_event_type" AS ENUM('sent', 'delivered', 'deferred', 'bounced', 'complained', 'failed');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'delivered', 'deferred', 'bounced', 'complained', 'partial_failure');--> statement-breakpoint
CREATE TYPE "public"."domain_status" AS ENUM('pending', 'verified', 'failed');--> statement-breakpoint
CREATE TYPE "public"."mailbox_role" AS ENUM('inbox', 'sent', 'drafts', 'spam', 'trash', 'archive');--> statement-breakpoint
CREATE TYPE "public"."org_membership_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."org_membership_status" AS ENUM('invited', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."recipient_delivery_status" AS ENUM('pending', 'delivered', 'deferred', 'bounced', 'complained');--> statement-breakpoint
CREATE TYPE "public"."recipient_type" AS ENUM('to', 'cc', 'bcc');--> statement-breakpoint
CREATE TYPE "public"."record_status" AS ENUM('not_configured', 'verifying', 'verified', 'failed');--> statement-breakpoint
CREATE TYPE "public"."suppression_reason" AS ENUM('hard_bounce', 'complaint', 'manual');--> statement-breakpoint
CREATE TYPE "public"."transport_status" AS ENUM('preparing', 'queued', 'sending', 'accepted', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'disabled');--> statement-breakpoint
CREATE TABLE "aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" uuid NOT NULL,
	"source" text NOT NULL,
	"target_account_id" uuid,
	"alias_status" "alias_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text,
	"organization_id" uuid,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"metadata" jsonb,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"suppression_reason" "suppression_reason" NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"domain_status" "domain_status" DEFAULT 'pending' NOT NULL,
	"mx_status" "record_status" DEFAULT 'not_configured' NOT NULL,
	"spf_status" "record_status" DEFAULT 'not_configured' NOT NULL,
	"dkim_status" "record_status" DEFAULT 'not_configured' NOT NULL,
	"dmarc_status" "record_status" DEFAULT 'not_configured' NOT NULL,
	"dkim_selector" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" uuid NOT NULL,
	"user_id" text,
	"local_part" text NOT NULL,
	"address" text NOT NULL,
	"display_name" text,
	"account_status" "account_status" DEFAULT 'pending' NOT NULL,
	"quota_bytes" bigint,
	"used_bytes" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"engine_id" text NOT NULL,
	"engine_thread_id" text,
	"mailbox_role" "mailbox_role" DEFAULT 'inbox' NOT NULL,
	"from_email" text NOT NULL,
	"from_name" text,
	"to" jsonb DEFAULT '[]'::jsonb,
	"cc" jsonb DEFAULT '[]'::jsonb,
	"subject" text,
	"snippet" text,
	"read" boolean DEFAULT false NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"has_attachments" boolean DEFAULT false NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"spf" text,
	"dkim" text,
	"dmarc" text,
	"spam_score" numeric(4, 2),
	"keywords" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_account_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"account_membership_role" "account_membership_role" DEFAULT 'delegate' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"mailbox_role" "mailbox_role" NOT NULL,
	"engine_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"engine_thread_id" text NOT NULL,
	"subject" text,
	"last_message_at" timestamp with time zone NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"org_membership_role" "org_membership_role" DEFAULT 'member' NOT NULL,
	"org_membership_status" "org_membership_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outbound_message_id" uuid NOT NULL,
	"engine_attachment_id" text,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"content_disposition" text DEFAULT 'attachment' NOT NULL,
	"content_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_delivery_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outbound_message_id" uuid NOT NULL,
	"delivery_event_type" "delivery_event_type" NOT NULL,
	"detail" jsonb,
	"provider_event_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"transport_status" "transport_status" DEFAULT 'preparing' NOT NULL,
	"delivery_status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"from_address" text NOT NULL,
	"to" jsonb NOT NULL,
	"cc" jsonb DEFAULT '[]'::jsonb,
	"bcc" jsonb DEFAULT '[]'::jsonb,
	"subject" text,
	"text_body" text,
	"html_body" text,
	"reply_to" text,
	"in_reply_to" text,
	"references" text,
	"message_id" text,
	"client_request_id" text,
	"engine_message_id" text,
	"engine_thread_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"undo_until" timestamp with time zone,
	"preparing_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"failure_code" text,
	"failure_detail" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outbound_message_id" uuid NOT NULL,
	"email" text NOT NULL,
	"recipient_type" "recipient_type" NOT NULL,
	"recipient_delivery_status" "recipient_delivery_status" DEFAULT 'pending' NOT NULL,
	"provider_recipient_id" text,
	"last_event_at" timestamp with time zone,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"identity_provider" text DEFAULT 'gsw' NOT NULL,
	"identity_subject" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text,
	"user_status" "user_status" DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aliases" ADD CONSTRAINT "aliases_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aliases" ADD CONSTRAINT "aliases_target_account_id_email_accounts_id_fk" FOREIGN KEY ("target_account_id") REFERENCES "public"."email_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_suppressions" ADD CONSTRAINT "delivery_suppressions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_account_id_email_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."email_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_account_memberships" ADD CONSTRAINT "mail_account_memberships_account_id_email_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."email_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_account_memberships" ADD CONSTRAINT "mail_account_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_account_id_email_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."email_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_account_id_email_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."email_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_attachments" ADD CONSTRAINT "outbound_attachments_outbound_message_id_outbound_messages_id_fk" FOREIGN KEY ("outbound_message_id") REFERENCES "public"."outbound_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_delivery_events" ADD CONSTRAINT "outbound_delivery_events_outbound_message_id_outbound_messages_id_fk" FOREIGN KEY ("outbound_message_id") REFERENCES "public"."outbound_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_account_id_email_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."email_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_recipients" ADD CONSTRAINT "outbound_recipients_outbound_message_id_outbound_messages_id_fk" FOREIGN KEY ("outbound_message_id") REFERENCES "public"."outbound_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "aliases_source_idx" ON "aliases" USING btree ("domain_id","source");--> statement-breakpoint
CREATE INDEX "aliases_target_idx" ON "aliases" USING btree ("target_account_id");--> statement-breakpoint
CREATE INDEX "audit_org_idx" ON "audit_events" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "audit_action_idx" ON "audit_events" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "suppressions_org_email_idx" ON "delivery_suppressions" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "suppressions_email_idx" ON "delivery_suppressions" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "domains_name_idx" ON "domains" USING btree ("name");--> statement-breakpoint
CREATE INDEX "domains_org_idx" ON "domains" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_accounts_address_idx" ON "email_accounts" USING btree ("address");--> statement-breakpoint
CREATE INDEX "email_accounts_user_idx" ON "email_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "email_accounts_domain_idx" ON "email_accounts" USING btree ("domain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_account_engine_idx" ON "inbound_messages" USING btree ("account_id","engine_id");--> statement-breakpoint
CREATE INDEX "inbound_account_mailbox_idx" ON "inbound_messages" USING btree ("account_id","mailbox_role");--> statement-breakpoint
CREATE INDEX "inbound_thread_idx" ON "inbound_messages" USING btree ("engine_thread_id");--> statement-breakpoint
CREATE INDEX "inbound_date_idx" ON "inbound_messages" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "account_memberships_account_user_idx" ON "mail_account_memberships" USING btree ("account_id","user_id");--> statement-breakpoint
CREATE INDEX "account_memberships_user_idx" ON "mail_account_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mailboxes_account_role_idx" ON "mailboxes" USING btree ("account_id","mailbox_role");--> statement-breakpoint
CREATE UNIQUE INDEX "message_threads_account_engine_idx" ON "message_threads" USING btree ("account_id","engine_thread_id");--> statement-breakpoint
CREATE INDEX "message_threads_account_idx" ON "message_threads" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_memberships_org_user_idx" ON "organization_memberships" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "org_memberships_user_idx" ON "organization_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_idx" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "outbound_attachments_msg_idx" ON "outbound_attachments" USING btree ("outbound_message_id");--> statement-breakpoint
CREATE INDEX "delivery_event_msg_idx" ON "outbound_delivery_events" USING btree ("outbound_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_event_provider_idx" ON "outbound_delivery_events" USING btree ("provider_event_id");--> statement-breakpoint
CREATE INDEX "outbound_transport_idx" ON "outbound_messages" USING btree ("transport_status");--> statement-breakpoint
CREATE INDEX "outbound_account_idx" ON "outbound_messages" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "outbound_due_idx" ON "outbound_messages" USING btree ("transport_status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_account_request_idx" ON "outbound_messages" USING btree ("account_id","client_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_recipients_msg_email_idx" ON "outbound_recipients" USING btree ("outbound_message_id","email");--> statement-breakpoint
CREATE INDEX "outbound_recipients_status_idx" ON "outbound_recipients" USING btree ("recipient_delivery_status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_identity_idx" ON "users" USING btree ("identity_provider","identity_subject");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");