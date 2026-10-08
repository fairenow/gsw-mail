import { pool } from "../db/client.js";

export async function ensureEmailTemplateSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "email_templates" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "key" text NOT NULL,
      "name" text NOT NULL,
      "border_color" text DEFAULT '#e8e1d4' NOT NULL,
      "font_color" text DEFAULT '#484640' NOT NULL,
      "button_color" text DEFAULT '#e89a12' NOT NULL,
      "background_color" text DEFAULT '#f7f3ea' NOT NULL,
      "logo_mime_type" text,
      "logo_base64" text,
      "logo_filename" text,
      "logo_asset_id" uuid REFERENCES "assets"("id") ON DELETE SET NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    );
  `);
  await pool.query(`ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "logo_asset_id" uuid REFERENCES "assets"("id") ON DELETE SET NULL;`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS "email_templates_key_idx" ON "email_templates" ("key");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "email_templates_user_idx" ON "email_templates" ("user_id", "created_at");`);
}
