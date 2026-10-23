ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "subject" text;
ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "preheader" text;
ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "body_text" text;
