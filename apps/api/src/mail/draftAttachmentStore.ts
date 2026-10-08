import { and, asc, eq, sql } from "drizzle-orm";
import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { db } from "../db/client.js";
import { assets, emailAccounts } from "../db/schema.js";
import type { SendAttachment } from "../engine/types.js";
import { createAssetFromBuffer, deleteAsset } from "../files/service.js";
import { getR2Object } from "../files/r2.js";

const draftAttachmentPayloads = pgTable("draft_attachment_payloads", {
  accountId: uuid("account_id").notNull(),
  draftEngineId: text("draft_engine_id").notNull(),
  position: integer("position").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  contentDisposition: text("content_disposition"),
  contentId: text("content_id"),
  contentBase64: text("content_base64").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

const draftAttachmentAssets = pgTable("draft_attachment_assets", {
  accountId: uuid("account_id").notNull(),
  draftEngineId: text("draft_engine_id").notNull(),
  position: integer("position").notNull(),
  userId: text("user_id").notNull(),
  assetId: uuid("asset_id").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  contentDisposition: text("content_disposition"),
  contentId: text("content_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

let ensureTablePromise: Promise<unknown> | undefined;
const ensureTable = async (): Promise<void> => {
  ensureTablePromise ??= db.execute(sql`
    CREATE TABLE IF NOT EXISTS "draft_attachment_payloads" (
      "account_id" uuid NOT NULL,
      "draft_engine_id" text NOT NULL,
      "position" integer NOT NULL,
      "filename" text NOT NULL,
      "content_type" text NOT NULL,
      "size" integer NOT NULL,
      "content_disposition" text,
      "content_id" text,
      "content_base64" text NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("account_id", "draft_engine_id", "position")
    );

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

    CREATE INDEX IF NOT EXISTS "draft_attachment_assets_asset_idx"
      ON "draft_attachment_assets" ("asset_id");
  `);
  await ensureTablePromise;
};

export type DraftAttachmentMeta = {
  position: number;
  filename: string;
  contentType: string;
  size: number;
  contentDisposition?: string | undefined;
  contentId?: string | undefined;
  assetId?: string | undefined;
};

async function resolveUserId(accountId: string, explicitUserId?: string): Promise<string> {
  if (explicitUserId) return explicitUserId;
  const [account] = await db.select({ userId: emailAccounts.userId }).from(emailAccounts)
    .where(eq(emailAccounts.id, accountId))
    .limit(1);
  if (!account?.userId) throw new Error("draft attachment account owner not found");
  return account.userId;
}

async function ingestAttachment(
  userId: string,
  accountId: string,
  draftEngineId: string,
  attachment: SendAttachment,
  position: number,
) {
  if (!attachment.content) throw new Error(`attachment ${attachment.filename} is missing base64 content`);
  const bytes = Buffer.from(attachment.content, "base64");
  const asset = await createAssetFromBuffer({
    userId,
    filename: attachment.filename,
    mimeType: attachment.contentType || "application/octet-stream",
    content: bytes,
    source: "email_attachment",
    kind: "email_attachment",
    addToFiles: false,
  });
  return {
    accountId,
    draftEngineId,
    position,
    userId,
    assetId: asset.id,
    filename: attachment.filename,
    contentType: attachment.contentType || "application/octet-stream",
    size: bytes.byteLength,
    contentDisposition: attachment.contentDisposition ?? null,
    contentId: attachment.contentId ?? null,
  };
}

async function cleanupAssets(rows: Array<{ userId: string; assetId: string }>) {
  await Promise.all(rows.map((row) => deleteAsset(row.userId, row.assetId).catch(() => undefined)));
}

export async function replaceDraftAttachments(
  accountId: string,
  draftEngineId: string,
  attachments: SendAttachment[],
  explicitUserId?: string,
): Promise<void> {
  await ensureTable();
  const userId = await resolveUserId(accountId, explicitUserId);
  const oldRows = await db.select({ userId: draftAttachmentAssets.userId, assetId: draftAttachmentAssets.assetId })
    .from(draftAttachmentAssets)
    .where(and(eq(draftAttachmentAssets.accountId, accountId), eq(draftAttachmentAssets.draftEngineId, draftEngineId)));

  const newRows: Awaited<ReturnType<typeof ingestAttachment>>[] = [];
  try {
    for (const [position, attachment] of attachments.entries()) {
      newRows.push(await ingestAttachment(userId, accountId, draftEngineId, attachment, position));
    }

    await db.transaction(async (tx) => {
      await tx.delete(draftAttachmentAssets).where(and(
        eq(draftAttachmentAssets.accountId, accountId),
        eq(draftAttachmentAssets.draftEngineId, draftEngineId),
      ));
      await tx.delete(draftAttachmentPayloads).where(and(
        eq(draftAttachmentPayloads.accountId, accountId),
        eq(draftAttachmentPayloads.draftEngineId, draftEngineId),
      ));
      if (newRows.length) await tx.insert(draftAttachmentAssets).values(newRows);
    });
  } catch (error) {
    await cleanupAssets(newRows);
    throw error;
  }

  await cleanupAssets(oldRows);
}

export async function appendDraftAttachments(
  accountId: string,
  draftEngineId: string,
  attachments: SendAttachment[],
  explicitUserId?: string,
): Promise<void> {
  if (!attachments.length) return;
  await ensureTable();
  const userId = await resolveUserId(accountId, explicitUserId);
  const existing = await listDraftAttachments(accountId, draftEngineId);
  const nextPosition = existing.reduce((max, item) => Math.max(max, item.position), -1) + 1;
  const newRows: Awaited<ReturnType<typeof ingestAttachment>>[] = [];
  try {
    for (const [offset, attachment] of attachments.entries()) {
      newRows.push(await ingestAttachment(userId, accountId, draftEngineId, attachment, nextPosition + offset));
    }
    if (newRows.length) await db.insert(draftAttachmentAssets).values(newRows);
  } catch (error) {
    await cleanupAssets(newRows);
    throw error;
  }
}

export async function removeDraftAttachment(
  accountId: string,
  draftEngineId: string,
  position: number,
  explicitUserId?: string,
): Promise<void> {
  await ensureTable();
  const [row] = await db.select({ userId: draftAttachmentAssets.userId, assetId: draftAttachmentAssets.assetId })
    .from(draftAttachmentAssets)
    .where(and(
      eq(draftAttachmentAssets.accountId, accountId),
      eq(draftAttachmentAssets.draftEngineId, draftEngineId),
      eq(draftAttachmentAssets.position, position),
    )).limit(1);

  if (row) {
    await db.delete(draftAttachmentAssets).where(and(
      eq(draftAttachmentAssets.accountId, accountId),
      eq(draftAttachmentAssets.draftEngineId, draftEngineId),
      eq(draftAttachmentAssets.position, position),
    ));
    await deleteAsset(row.userId, row.assetId).catch(() => undefined);
    return;
  }

  await resolveUserId(accountId, explicitUserId);
  await db.delete(draftAttachmentPayloads).where(and(
    eq(draftAttachmentPayloads.accountId, accountId),
    eq(draftAttachmentPayloads.draftEngineId, draftEngineId),
    eq(draftAttachmentPayloads.position, position),
  ));
}

export async function moveDraftAttachments(accountId: string, fromDraftEngineId: string, toDraftEngineId: string): Promise<void> {
  if (fromDraftEngineId === toDraftEngineId) return;
  await ensureTable();
  await Promise.all([
    db.update(draftAttachmentAssets)
      .set({ draftEngineId: toDraftEngineId })
      .where(and(eq(draftAttachmentAssets.accountId, accountId), eq(draftAttachmentAssets.draftEngineId, fromDraftEngineId))),
    db.update(draftAttachmentPayloads)
      .set({ draftEngineId: toDraftEngineId })
      .where(and(eq(draftAttachmentPayloads.accountId, accountId), eq(draftAttachmentPayloads.draftEngineId, fromDraftEngineId))),
  ]);
}

export async function listDraftAttachments(accountId: string, draftEngineId: string): Promise<DraftAttachmentMeta[]> {
  await ensureTable();
  const assetRows = await db.select({
    position: draftAttachmentAssets.position,
    filename: draftAttachmentAssets.filename,
    contentType: draftAttachmentAssets.contentType,
    size: draftAttachmentAssets.size,
    contentDisposition: draftAttachmentAssets.contentDisposition,
    contentId: draftAttachmentAssets.contentId,
    assetId: draftAttachmentAssets.assetId,
  }).from(draftAttachmentAssets)
    .where(and(eq(draftAttachmentAssets.accountId, accountId), eq(draftAttachmentAssets.draftEngineId, draftEngineId)))
    .orderBy(asc(draftAttachmentAssets.position));

  if (assetRows.length) {
    return assetRows.map((row) => ({
      position: row.position,
      filename: row.filename,
      contentType: row.contentType,
      size: row.size,
      assetId: row.assetId,
      ...(row.contentDisposition ? { contentDisposition: row.contentDisposition } : {}),
      ...(row.contentId ? { contentId: row.contentId } : {}),
    }));
  }

  const rows = await db.select({
    position: draftAttachmentPayloads.position,
    filename: draftAttachmentPayloads.filename,
    contentType: draftAttachmentPayloads.contentType,
    size: draftAttachmentPayloads.size,
    contentDisposition: draftAttachmentPayloads.contentDisposition,
    contentId: draftAttachmentPayloads.contentId,
  }).from(draftAttachmentPayloads)
    .where(and(eq(draftAttachmentPayloads.accountId, accountId), eq(draftAttachmentPayloads.draftEngineId, draftEngineId)))
    .orderBy(asc(draftAttachmentPayloads.position));
  return rows.map((row) => ({
    position: row.position,
    filename: row.filename,
    contentType: row.contentType,
    size: row.size,
    ...(row.contentDisposition ? { contentDisposition: row.contentDisposition } : {}),
    ...(row.contentId ? { contentId: row.contentId } : {}),
  }));
}

export async function loadDraftAttachments(accountId: string, draftEngineId: string): Promise<SendAttachment[]> {
  await ensureTable();
  const rows = await db.select({
    position: draftAttachmentAssets.position,
    filename: draftAttachmentAssets.filename,
    contentType: draftAttachmentAssets.contentType,
    size: draftAttachmentAssets.size,
    contentDisposition: draftAttachmentAssets.contentDisposition,
    contentId: draftAttachmentAssets.contentId,
    r2Key: assets.r2Key,
  }).from(draftAttachmentAssets)
    .innerJoin(assets, eq(draftAttachmentAssets.assetId, assets.id))
    .where(and(
      eq(draftAttachmentAssets.accountId, accountId),
      eq(draftAttachmentAssets.draftEngineId, draftEngineId),
      eq(assets.status, "ready"),
    ))
    .orderBy(asc(draftAttachmentAssets.position));

  if (rows.length) {
    const loaded: SendAttachment[] = [];
    for (const row of rows) {
      const object = await getR2Object(row.r2Key);
      loaded.push({
        filename: row.filename,
        contentType: row.contentType || object.contentType || "application/octet-stream",
        size: row.size,
        ...(row.contentDisposition ? { contentDisposition: row.contentDisposition } : {}),
        ...(row.contentId ? { contentId: row.contentId } : {}),
        content: object.content.toString("base64"),
      });
    }
    return loaded;
  }

  const legacyRows = await db.select().from(draftAttachmentPayloads)
    .where(and(eq(draftAttachmentPayloads.accountId, accountId), eq(draftAttachmentPayloads.draftEngineId, draftEngineId)))
    .orderBy(asc(draftAttachmentPayloads.position));
  return legacyRows.map((row) => ({
    filename: row.filename,
    contentType: row.contentType,
    size: row.size,
    ...(row.contentDisposition ? { contentDisposition: row.contentDisposition } : {}),
    ...(row.contentId ? { contentId: row.contentId } : {}),
    content: row.contentBase64,
  }));
}

export async function clearDraftAttachments(
  accountId: string,
  draftEngineId: string,
  explicitUserId?: string,
): Promise<void> {
  await ensureTable();
  const rows = await db.select({ userId: draftAttachmentAssets.userId, assetId: draftAttachmentAssets.assetId })
    .from(draftAttachmentAssets)
    .where(and(eq(draftAttachmentAssets.accountId, accountId), eq(draftAttachmentAssets.draftEngineId, draftEngineId)));

  await db.transaction(async (tx) => {
    await tx.delete(draftAttachmentAssets).where(and(
      eq(draftAttachmentAssets.accountId, accountId),
      eq(draftAttachmentAssets.draftEngineId, draftEngineId),
    ));
    await tx.delete(draftAttachmentPayloads).where(and(
      eq(draftAttachmentPayloads.accountId, accountId),
      eq(draftAttachmentPayloads.draftEngineId, draftEngineId),
    ));
  });

  if (!rows.length && explicitUserId) await resolveUserId(accountId, explicitUserId);
  await cleanupAssets(rows);
}
