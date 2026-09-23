import { asc, eq, sql } from "drizzle-orm";
import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { db } from "../db/client.js";
import type { SendAttachment } from "../engine/types.js";
import type { RelayAttachment } from "./types.js";

const outboundAttachmentPayloads = pgTable("outbound_attachment_payloads", {
  outboundMessageId: uuid("outbound_message_id").notNull(),
  position: integer("position").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  contentId: text("content_id"),
  contentBase64: text("content_base64").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

let ensureTablePromise: Promise<unknown> | undefined;
const ensurePayloadTable = async (): Promise<void> => {
  ensureTablePromise ??= db.execute(sql`
    CREATE TABLE IF NOT EXISTS "outbound_attachment_payloads" (
      "outbound_message_id" uuid NOT NULL REFERENCES "outbound_messages"("id") ON DELETE CASCADE,
      "position" integer NOT NULL,
      "filename" text NOT NULL,
      "content_type" text NOT NULL,
      "content_id" text,
      "content_base64" text NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("outbound_message_id", "position")
    )
  `);
  await ensureTablePromise;
};

export async function storeOutboundAttachmentPayloads(
  outboundMessageId: string,
  attachments: SendAttachment[],
): Promise<void> {
  if (attachments.length === 0) return;
  await ensurePayloadTable();
  const rows = attachments.map((attachment, position) => {
    if (!attachment.content) throw new Error(`attachment ${attachment.filename} is missing base64 content`);
    return {
      outboundMessageId,
      position,
      filename: attachment.filename,
      contentType: attachment.contentType || "application/octet-stream",
      contentId: attachment.contentId ?? null,
      contentBase64: attachment.content,
    };
  });
  await db.insert(outboundAttachmentPayloads).values(rows);
}

export async function loadOutboundAttachmentPayloads(outboundMessageId: string): Promise<RelayAttachment[]> {
  await ensurePayloadTable();
  const rows = await db
    .select({
      filename: outboundAttachmentPayloads.filename,
      contentType: outboundAttachmentPayloads.contentType,
      contentId: outboundAttachmentPayloads.contentId,
      contentBase64: outboundAttachmentPayloads.contentBase64,
    })
    .from(outboundAttachmentPayloads)
    .where(eq(outboundAttachmentPayloads.outboundMessageId, outboundMessageId))
    .orderBy(asc(outboundAttachmentPayloads.position));
  return rows.map((row) => ({
    filename: row.filename,
    contentType: row.contentType,
    content: Buffer.from(row.contentBase64, "base64"),
    contentId: row.contentId ?? undefined,
  }));
}

export async function clearOutboundAttachmentPayloads(outboundMessageId: string): Promise<void> {
  await ensurePayloadTable();
  await db.delete(outboundAttachmentPayloads).where(eq(outboundAttachmentPayloads.outboundMessageId, outboundMessageId));
}
