CREATE TABLE IF NOT EXISTS "domain_dns_state" (
  "domain_id" uuid PRIMARY KEY NOT NULL,
  "stalwart_domain_id" text,
  "stalwart_dns_zone_file" text,
  "resend_domain_id" text,
  "expected_records" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "observed_records" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "last_checked_at" timestamp with time zone,
  "last_healthy_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "domain_dns_state_domain_id_domains_id_fk"
    FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action
);
