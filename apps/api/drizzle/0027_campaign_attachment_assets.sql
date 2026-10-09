ALTER TABLE "ai_campaigns" ADD COLUMN IF NOT EXISTS "attachment_asset_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL;
