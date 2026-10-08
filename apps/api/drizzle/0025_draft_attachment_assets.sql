CREATE TABLE IF NOT EXISTS "draft_attachment_assets" (
  "account_id" uuid NOT NULL,
  "draft_engine_id" text NOT NULL,
  "position" integer NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "asset_id" uuid NOT NULL REFERENCES "assets"("id") ON DELETE CASCADE,
  "filename" text NOT NULL,
  "content_type" text NOT NULL,
  "size" integer NOT NULL,
  "content_disposition" text,
  "content_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("account_id", "draft_engine_id", "position")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "draft_attachment_assets_asset_idx"
  ON "draft_attachment_assets" USING btree ("asset_id");