CREATE TYPE "public"."contact_import_duplicate_behavior" AS ENUM('skip', 'merge', 'overwrite');--> statement-breakpoint
CREATE TYPE "public"."signature_position" AS ENUM('beforeQuotedText', 'afterQuotedText');--> statement-breakpoint
CREATE TABLE "contact_custom_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"value" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"email" text NOT NULL,
	"normalized_email" text NOT NULL,
	"label" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"filename" text NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"contact_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_phones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"label" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"normalized_tag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"first_name" text,
	"middle_name" text,
	"last_name" text,
	"display_name" text,
	"organization" text,
	"job_title" text,
	"website" text,
	"address" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"country" text,
	"notes" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_file" text,
	"import_batch_id" uuid,
	"last_contacted_at" timestamp with time zone,
	"first_contacted_at" timestamp with time zone,
	"times_emailed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"signature_html" text DEFAULT '' NOT NULL,
	"signature_text" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"on_new" boolean DEFAULT true NOT NULL,
	"on_reply" boolean DEFAULT true NOT NULL,
	"on_forward" boolean DEFAULT true NOT NULL,
	"signature_position" "signature_position" DEFAULT 'beforeQuotedText' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"general" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"compose" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"contacts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "template_key" text DEFAULT 'gsw_default' NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_custom_fields" ADD CONSTRAINT "contact_custom_fields_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_emails" ADD CONSTRAINT "contact_emails_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_import_batches" ADD CONSTRAINT "contact_import_batches_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_import_rows" ADD CONSTRAINT "contact_import_rows_batch_id_contact_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."contact_import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_import_rows" ADD CONSTRAINT "contact_import_rows_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_phones" ADD CONSTRAINT "contact_phones_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_import_batch_id_contact_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."contact_import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_signatures" ADD CONSTRAINT "email_signatures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_custom_fields_contact_key_idx" ON "contact_custom_fields" USING btree ("contact_id","field_key");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_emails_contact_normalized_idx" ON "contact_emails" USING btree ("contact_id","normalized_email");--> statement-breakpoint
CREATE INDEX "contact_emails_normalized_idx" ON "contact_emails" USING btree ("normalized_email");--> statement-breakpoint
CREATE INDEX "contact_import_batches_owner_idx" ON "contact_import_batches" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "contact_import_rows_batch_idx" ON "contact_import_rows" USING btree ("batch_id","row_number");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_phones_contact_phone_idx" ON "contact_phones" USING btree ("contact_id","phone");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_tags_contact_normalized_idx" ON "contact_tags" USING btree ("contact_id","normalized_tag");--> statement-breakpoint
CREATE INDEX "contact_tags_search_idx" ON "contact_tags" USING btree ("normalized_tag");--> statement-breakpoint
CREATE INDEX "contacts_owner_idx" ON "contacts" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "contacts_search_idx" ON "contacts" USING btree ("owner_user_id","display_name","organization");--> statement-breakpoint
CREATE UNIQUE INDEX "email_signatures_user_idx" ON "email_signatures" USING btree ("user_id");