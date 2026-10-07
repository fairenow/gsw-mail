ALTER TABLE "user_settings"
ADD COLUMN IF NOT EXISTS "ai" jsonb DEFAULT '{}'::jsonb NOT NULL;
