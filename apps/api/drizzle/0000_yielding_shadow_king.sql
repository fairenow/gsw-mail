CREATE TYPE "public"."account_status" AS ENUM('pending', 'active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."alias_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."delivery_event_type" AS ENUM('sent', 'delivered', 'deferred', 'bounced', 'failed');--> statement-breakpoint
CREATE TYPE "public"."domain_status" AS ENUM('pending', 'verified', 'failed');--> statement-breakpoint
CREATE TYPE "public"."mailbox_role" AS ENUM('inbox', 'sent', 'drafts', 'spam', 'trash', 'archive');--> statement-breakpoint
CREATE TYPE "public"."outbound_status" AS ENUM('draft', 'queued', 'sending', 'sent', 'delivered', 'deferred', 'bounced', 'failed');--> statement-breakpoint
CREATE TYPE "public"."record_status" AS ENUM('not_configured', 'verifying', 'verified', 'failed');--> statement-breakpoint
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
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_delivery_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outbound_message_id" uuid NOT NULL,
	"delivery_event_type" "delivery_event_type" NOT NULL,
	"detail" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"outbound_status" "outbound_status" DEFAULT 'queued' NOT NULL,
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
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aliases" ADD CONSTRAINT "aliases_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aliases" ADD CONSTRAINT "aliases_target_account_id_email_accounts_id_fk" FOREIGN KEY ("target_account_id") REFERENCES "public"."email_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_account_id_email_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."email_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_account_id_email_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."email_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_account_id_email_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."email_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_delivery_events" ADD CONSTRAINT "outbound_delivery_events_outbound_message_id_outbound_messages_id_fk" FOREIGN KEY ("outbound_message_id") REFERENCES "public"."outbound_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_account_id_email_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."email_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "aliases_source_idx" ON "aliases" USING btree ("domain_id","source");--> statement-breakpoint
CREATE INDEX "aliases_target_idx" ON "aliases" USING btree ("target_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "domains_name_idx" ON "domains" USING btree ("name");--> statement-breakpoint
CREATE INDEX "domains_org_idx" ON "domains" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_accounts_address_idx" ON "email_accounts" USING btree ("address");--> statement-breakpoint
CREATE INDEX "email_accounts_user_idx" ON "email_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "email_accounts_domain_idx" ON "email_accounts" USING btree ("domain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_account_engine_idx" ON "inbound_messages" USING btree ("account_id","engine_id");--> statement-breakpoint
CREATE INDEX "inbound_account_mailbox_idx" ON "inbound_messages" USING btree ("account_id","mailbox_role");--> statement-breakpoint
CREATE INDEX "inbound_thread_idx" ON "inbound_messages" USING btree ("engine_thread_id");--> statement-breakpoint
CREATE INDEX "inbound_date_idx" ON "inbound_messages" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "mailboxes_account_role_idx" ON "mailboxes" USING btree ("account_id","mailbox_role");--> statement-breakpoint
CREATE UNIQUE INDEX "message_threads_account_engine_idx" ON "message_threads" USING btree ("account_id","engine_thread_id");--> statement-breakpoint
CREATE INDEX "message_threads_account_idx" ON "message_threads" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_idx" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "delivery_event_msg_idx" ON "outbound_delivery_events" USING btree ("outbound_message_id");--> statement-breakpoint
CREATE INDEX "outbound_status_idx" ON "outbound_messages" USING btree ("outbound_status");--> statement-breakpoint
CREATE INDEX "outbound_account_idx" ON "outbound_messages" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "outbound_next_attempt_idx" ON "outbound_messages" USING btree ("outbound_status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");