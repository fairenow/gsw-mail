import { eq, isNull } from "drizzle-orm";
import { pool, db } from "../db/client.js";
import { emailTemplates } from "../db/schema.js";
import { createAssetFromBuffer } from "./service.js";

async function backfillTemplateLogos() {
  const rows = await db.select().from(emailTemplates)
    .where(isNull(emailTemplates.logoAssetId));

  let migrated = 0;
  for (const template of rows) {
    if (!template.logoBase64 || !template.logoMimeType) continue;
    const asset = await createAssetFromBuffer({
      userId: template.userId,
      filename: template.logoFilename || `template-${template.id}-logo`,
      mimeType: template.logoMimeType,
      content: Buffer.from(template.logoBase64, "base64"),
      source: "template_legacy_backfill",
      kind: "template_asset",
      addToFiles: false,
    });
    await db.update(emailTemplates)
      .set({ logoAssetId: asset.id, updatedAt: new Date() })
      .where(eq(emailTemplates.id, template.id));
    migrated += 1;
    console.log(`[r2-backfill] template ${template.id} -> asset ${asset.id}`);
  }
  return migrated;
}

async function backfillDraftAttachments() {
  const result = await pool.query<{
    account_id: string;
    draft_engine_id: string;
    position: number;
    filename: string;
    content_type: string;
    size: number;
    content_disposition: string | null;
    content_id: string | null;
    content_base64: string;
    user_id: string;
  }>(`
    SELECT p.account_id, p.draft_engine_id, p.position, p.filename, p.content_type, p.size,
           p.content_disposition, p.content_id, p.content_base64, a.user_id
    FROM draft_attachment_payloads p
    JOIN email_accounts a ON a.id = p.account_id
    LEFT JOIN draft_attachment_assets r
      ON r.account_id = p.account_id
     AND r.draft_engine_id = p.draft_engine_id
     AND r.position = p.position
    WHERE r.asset_id IS NULL
    ORDER BY p.created_at ASC
  `);

  let migrated = 0;
  for (const row of result.rows) {
    const bytes = Buffer.from(row.content_base64, "base64");
    const asset = await createAssetFromBuffer({
      userId: row.user_id,
      filename: row.filename,
      mimeType: row.content_type || "application/octet-stream",
      content: bytes,
      source: "email_attachment_legacy_backfill",
      kind: "email_attachment",
      addToFiles: false,
    });
    await pool.query(`
      INSERT INTO draft_attachment_assets (
        account_id, draft_engine_id, position, user_id, asset_id, filename,
        content_type, size, content_disposition, content_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (account_id, draft_engine_id, position) DO NOTHING
    `, [
      row.account_id,
      row.draft_engine_id,
      row.position,
      row.user_id,
      asset.id,
      row.filename,
      row.content_type || "application/octet-stream",
      bytes.byteLength,
      row.content_disposition,
      row.content_id,
    ]);
    migrated += 1;
    console.log(`[r2-backfill] draft ${row.draft_engine_id} attachment ${row.position} -> asset ${asset.id}`);
  }
  return migrated;
}

async function main() {
  const templates = await backfillTemplateLogos();
  const attachments = await backfillDraftAttachments();
  console.log(`[r2-backfill] complete: ${templates} template logos, ${attachments} draft attachments`);
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
