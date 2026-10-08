CREATE TABLE IF NOT EXISTS "user_storage_quotas" (
  "user_id" text PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "plan_key" text DEFAULT 'free' NOT NULL,
  "quota_bytes" bigint NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "workspace_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL,
  "r2_key" text NOT NULL,
  "filename" text NOT NULL,
  "display_name" text NOT NULL,
  "mime_type" text DEFAULT 'application/octet-stream' NOT NULL,
  "extension" text,
  "size_bytes" bigint DEFAULT 0 NOT NULL,
  "etag" text,
  "kind" text DEFAULT 'file' NOT NULL,
  "source" text DEFAULT 'user_upload' NOT NULL,
  "visibility" text DEFAULT 'private' NOT NULL,
  "status" text DEFAULT 'upload_pending' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assets_r2_key_idx" ON "assets" USING btree ("r2_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_user_status_idx" ON "assets" USING btree ("user_id","status","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_workspace_idx" ON "assets" USING btree ("workspace_id","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "file_nodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "asset_id" uuid REFERENCES "assets"("id") ON DELETE CASCADE,
  "parent_id" uuid REFERENCES "file_nodes"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "node_type" text NOT NULL,
  "starred" boolean DEFAULT false NOT NULL,
  "trashed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_nodes_user_parent_idx" ON "file_nodes" USING btree ("user_id","parent_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "file_nodes_asset_idx" ON "file_nodes" USING btree ("asset_id") WHERE "asset_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "asset_id" uuid NOT NULL REFERENCES "assets"("id") ON DELETE CASCADE,
  "relation_type" text NOT NULL,
  "resource_type" text,
  "resource_id" text,
  "position" integer,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_links_user_relation_idx" ON "asset_links" USING btree ("user_id","relation_type","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_links_resource_idx" ON "asset_links" USING btree ("resource_type","resource_id");