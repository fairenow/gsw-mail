import { and, asc, eq, sql } from "drizzle-orm";
import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { db } from "../db/client.js";
import type { SendAttachment } from "../engine/types.js";

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
    )
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
};

const rowFor = (accountId: string, draftEngineId: string, attachment: SendAttachment, position: number) => {
  if (!attachment.content) throw new Error(`attachment ${attachment.filename} is missing base64 content`);
  return {
    accountId,
    draftEngineId,
    position,
    filename: attachment.filename,
    contentType: attachment.contentType || "application/octet-stream",
    size: attachment.size,
    contentDisposition: attachment.contentDisposition ?? null,
    contentId: attachment.contentId ?? null,
    contentBase64: attachment.content,
  };
};

export async function replaceDraftAttachments(accountId: string, draftEngineId: string, attachments: SendAttachment[]): Promise<void> {
  await ensureTable();
  await db.delete(draftAttachmentPayloads).where(and(eq(draftAttachmentPayloads.accountId, accountId), eq(draftAttachmentPayloads.draftEngineId, draftEngineId)));
  if (!attachments.length) return;
  await db.insert(draftAttachmentPayloads).values(attachments.map((attachment, position) => rowFor(accountId, draftEngineId, attachment, position)));
}

export async function appendDraftAttachments(accountId: string, draftEngineId: string, attachments: SendAttachment[]): Promise<void> {
  if (!attachments.length) return;
  await ensureTable();
  const existing = await listDraftAttachments(accountId, draftEngineId);
  const nextPosition = existing.reduce((max, item) => Math.max(max, item.position), -1) + 1;
  await db.insert(draftAttachmentPayloads).values(attachments.map((attachment, offset) => rowFor(accountId, draftEngineId, attachment, nextPosition + offset)));
}

export async function removeDraftAttachment(accountId: string, draftEngineId: string, position: number): Promise<void> {
  await ensureTable();
  await db.delete(draftAttachmentPayloads).where(and(
    eq(draftAttachmentPayloads.accountId, accountId),
    eq(draftAttachmentPayloads.draftEngineId, draftEngineId),
    eq(draftAttachmentPayloads.position, position),
  ));
}

export async function moveDraftAttachments(accountId: string, fromDraftEngineId: string, toDraftEngineId: string): Promise<void> {
  if (fromDraftEngineId === toDraftEngineId) return;
  await ensureTable();
  await db.update(draftAttachmentPayloads)
    .set({ draftEngineId: toDraftEngineId })
    .where(and(eq(draftAttachmentPayloads.accountId, accountId), eq(draftAttachmentPayloads.draftEngineId, fromDraftEngineId)));
}

export async function listDraftAttachments(accountId: string, draftEngineId: string): Promise<DraftAttachmentMeta[]> {
  await ensureTable();
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
  const rows = await db.select().from(draftAttachmentPayloads)
    .where(and(eq(draftAttachmentPayloads.accountId, accountId), eq(draftAttachmentPayloads.draftEngineId, draftEngineId)))
    .orderBy(asc(draftAttachmentPayloads.position));
  return rows.map((row) => ({
    filename: row.filename,
    contentType: row.contentType,
    size: row.size,
    ...(row.contentDisposition ? { contentDisposition: row.contentDisposition } : {}),
    ...(row.contentId ? { contentId: row.contentId } : {}),
    content: row.contentBase64,
  }));
}

export async function clearDraftAttachments(accountId: string, draftEngineId: string): Promise<void> {
  await ensureTable();
  await db.delete(draftAttachmentPayloads).where(and(eq(draftAttachmentPayloads.accountId, accountId), eq(draftAttachmentPayloads.draftEngineId, draftEngineId)));
}
