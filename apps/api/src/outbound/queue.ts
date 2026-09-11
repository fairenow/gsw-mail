import { and, asc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { outboundAttachments, outboundDeliveryEvents, outboundMessages, outboundRecipients, recipientType } from "../db/schema.js";
import { tooManyRequests } from "../lib/errors.js";
import type { OutboundJob } from "./types.js";

export interface SendAttachment {
  engineAttachmentId?: string | null | undefined;
  filename: string;
  contentType: string;
  size: number;
  contentDisposition?: string | null | undefined;
  contentId?: string | null | undefined;
}

export interface SendPayload {
  accountId: string;
  fromAddress: string;
  to: string[];
  cc?: string[] | undefined;
  bcc?: string[] | undefined;
  subject?: string | undefined;
  textBody?: string | undefined;
  htmlBody?: string | undefined;
  replyTo?: string | undefined;
  inReplyTo?: string | undefined;
  references?: string | undefined;
  messageId?: string | undefined;
  attachments?: SendAttachment[] | undefined;
}

export interface ReserveInput extends SendPayload {
  clientRequestId?: string | undefined;
  undoUntil?: Date | undefined;
}

export type ReserveResult =
  | { reserved: true; id: string }
  | { reserved: false; id: string; existingStatus: string };

export async function reserveSendOperation(input: ReserveInput): Promise<ReserveResult> {
  const inserted = await db
    .insert(outboundMessages)
    .values({
      accountId: input.accountId,
      transportStatus: "preparing",
      deliveryStatus: "pending",
      fromAddress: input.fromAddress,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      textBody: input.textBody,
      htmlBody: input.htmlBody,
      replyTo: input.replyTo,
      inReplyTo: input.inReplyTo,
      references: input.references,
      messageId: input.messageId,
      clientRequestId: input.clientRequestId,
      preparingStartedAt: sql`now()`,
      nextAttemptAt: input.undoUntil,
    })
    .onConflictDoNothing({ target: [outboundMessages.accountId, outboundMessages.clientRequestId] })
    .returning({ id: outboundMessages.id });
  const created = inserted[0];
  if (created) return { reserved: true, id: created.id };

  const existing = await db
    .select({ id: outboundMessages.id, transportStatus: outboundMessages.transportStatus })
    .from(outboundMessages)
    .where(
      and(
        eq(outboundMessages.accountId, input.accountId),
        eq(outboundMessages.clientRequestId, input.clientRequestId ?? ""),
      ),
    )
    .limit(1);
  const row = existing[0];
  if (!row) throw new Error("send operation conflict without existing row");
  return { reserved: false, id: row.id, existingStatus: row.transportStatus };
}

export async function insertRecipients(
  outboundMessageId: string,
  to: string[],
  cc: string[] = [],
  bcc: string[] = [],
): Promise<void> {
  if (to.length === 0) return;
  const rows = [
    ...to.map((email) => ({ outboundMessageId, email, recipientType: "to" as const })),
    ...cc.map((email) => ({ outboundMessageId, email, recipientType: "cc" as const })),
    ...bcc.map((email) => ({ outboundMessageId, email, recipientType: "bcc" as const })),
  ];
  await db
    .insert(outboundRecipients)
    .values(rows)
    .onConflictDoNothing({ target: [outboundRecipients.outboundMessageId, outboundRecipients.email] });
}

export async function insertOutboundAttachments(
  outboundMessageId: string,
  attachments: SendAttachment[],
): Promise<void> {
  if (attachments.length === 0) return;
  const rows = attachments.map((a) => ({
    outboundMessageId,
    engineAttachmentId: a.engineAttachmentId ?? null,
    filename: a.filename,
    contentType: a.contentType,
    size: a.size,
    contentDisposition: a.contentDisposition ?? "attachment",
    contentId: a.contentId ?? null,
  }));
  await db.insert(outboundAttachments).values(rows);
}

export type TransportStatusRow = typeof outboundMessages.$inferSelect;

export async function finalizeSend(
  id: string,
  result: { engineMessageId: string; engineThreadId: string },
  nextAttemptAt: Date,
): Promise<void> {
  await db
    .update(outboundMessages)
    .set({
      transportStatus: "queued",
      engineMessageId: result.engineMessageId,
      engineThreadId: result.engineThreadId,
      nextAttemptAt,
    })
    .where(eq(outboundMessages.id, id));
}

export async function failSendPreparation(id: string, code: string, detail: string): Promise<void> {
  await db
    .update(outboundMessages)
    .set({ transportStatus: "failed", failureCode: code, failureDetail: detail, lastError: detail })
    .where(eq(outboundMessages.id, id));
}

const reclaimWindow = sql`now() - interval '5 minutes'`;
const backoffSteps = [30, 60, 120, 240];

export async function claimDueJobs(limit: number): Promise<{ id: string; accountId: string }[]> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: outboundMessages.id, accountId: outboundMessages.accountId })
      .from(outboundMessages)
      .where(
        or(
          and(
            eq(outboundMessages.transportStatus, "queued"),
            or(isNull(outboundMessages.nextAttemptAt), lte(outboundMessages.nextAttemptAt, sql`now()`)),
          ),
          and(eq(outboundMessages.transportStatus, "sending"), lte(outboundMessages.updatedAt, reclaimWindow)),
        ),
      )
      .orderBy(asc(outboundMessages.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true });

    if (due.length === 0) return [];

    return tx
      .update(outboundMessages)
      .set({
        transportStatus: "sending",
        attempts: sql`${outboundMessages.attempts} + 1`,
        nextAttemptAt: null,
        lastError: null,
      })
      .where(inArray(outboundMessages.id, due.map((d) => d.id)))
      .returning({ id: outboundMessages.id, accountId: outboundMessages.accountId });
  });
}

export async function loadJob(id: string): Promise<OutboundJob | null> {
  const rows = await db.select().from(outboundMessages).where(eq(outboundMessages.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;
  const attachments = await db
    .select({ engineId: outboundAttachments.engineAttachmentId, filename: outboundAttachments.filename })
    .from(outboundAttachments)
    .where(eq(outboundAttachments.outboundMessageId, id));
  return {
    id: row.id,
    accountId: row.accountId,
    fromAddress: row.fromAddress,
    to: row.to,
    cc: row.cc ?? undefined,
    bcc: row.bcc ?? undefined,
    subject: row.subject ?? undefined,
    textBody: row.textBody ?? undefined,
    htmlBody: row.htmlBody ?? undefined,
    replyTo: row.replyTo ?? undefined,
    inReplyTo: row.inReplyTo ?? undefined,
    references: row.references ?? undefined,
    messageId: row.messageId ?? undefined,
    attachments: attachments.map((a) => ({
      engineAttachmentId: a.engineId,
      filename: a.filename,
    })),
  };
}

export async function markAccepted(id: string, deliveryId?: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(outboundMessages)
      .set({ transportStatus: "accepted", acceptedAt: sql`now()` })
      .where(eq(outboundMessages.id, id));
    await tx.insert(outboundDeliveryEvents).values({
      outboundMessageId: id,
      type: "sent",
      detail: deliveryId ? { deliveryId } : {},
    });
  });
}

export async function markTransportRetry(id: string, message: string): Promise<void> {
  const rows = await db
    .select({ attempts: outboundMessages.attempts, maxAttempts: outboundMessages.maxAttempts })
    .from(outboundMessages)
    .where(eq(outboundMessages.id, id))
    .limit(1);
  const attempts = rows[0]?.attempts ?? 1;
  const maxAttempts = rows[0]?.maxAttempts ?? 5;
  if (attempts >= maxAttempts) {
    return markFailed(id, "max_attempts", `max attempts (${maxAttempts}) reached: ${message}`);
  }
  const seconds = backoffSteps[Math.min(attempts - 1, backoffSteps.length - 1)] ?? 240;
  await db
    .update(outboundMessages)
    .set({
      transportStatus: "queued",
      nextAttemptAt: sql`now() + (${seconds} * interval '1 second')`,
      lastError: message,
    })
    .where(eq(outboundMessages.id, id));
}

export async function markFailed(id: string, code: string, detail: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(outboundMessages)
      .set({ transportStatus: "failed", failureCode: code, failureDetail: detail, lastError: detail })
      .where(eq(outboundMessages.id, id));
    await tx.insert(outboundDeliveryEvents).values({
      outboundMessageId: id,
      type: "failed",
      detail: { code, message: detail },
    });
  });
}

export async function cancelSend(id: string): Promise<boolean> {
  const rows = await db
    .update(outboundMessages)
    .set({ transportStatus: "cancelled", cancelledAt: sql`now()` })
    .where(and(eq(outboundMessages.id, id), inArray(outboundMessages.transportStatus, ["preparing", "queued"])))
    .returning({ id: outboundMessages.id });
  return rows.length > 0;
}

export async function retrySend(id: string): Promise<boolean> {
  const rows = await db
    .update(outboundMessages)
    .set({
      transportStatus: "queued",
      attempts: 0,
      nextAttemptAt: sql`now()`,
      failureCode: null,
      failureDetail: null,
      lastError: null,
    })
    .where(and(eq(outboundMessages.id, id), eq(outboundMessages.transportStatus, "failed")))
    .returning({ id: outboundMessages.id });
  return rows.length > 0;
}

export interface SendStatus {
  id: string;
  transportStatus: TransportStatusRow["transportStatus"];
  deliveryStatus: TransportStatusRow["deliveryStatus"];
  messageId: string | null;
  engineMessageId: string | null;
  engineThreadId: string | null;
  attempts: number;
  nextAttemptAt: Date | null;
  undoUntil: Date | null;
  cancelledAt: Date | null;
  acceptedAt: Date | null;
  deliveredAt: Date | null;
  failureCode: string | null;
  failureDetail: string | null;
  recipients: { email: string; recipientType: (typeof recipientType.enumValues)[number]; status: TransportStatusRow["deliveryStatus"] }[];
}

export async function getSendStatus(id: string): Promise<SendStatus | null> {
  const rows = await db.select().from(outboundMessages).where(eq(outboundMessages.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;
  const recipients = await db
    .select({
      email: outboundRecipients.email,
      recipientType: outboundRecipients.recipientType,
      status: outboundRecipients.deliveryStatus,
    })
    .from(outboundRecipients)
    .where(eq(outboundRecipients.outboundMessageId, id));
  return {
    id: row.id,
    transportStatus: row.transportStatus,
    deliveryStatus: row.deliveryStatus,
    messageId: row.messageId,
    engineMessageId: row.engineMessageId,
    engineThreadId: row.engineThreadId,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt,
    undoUntil: row.undoUntil,
    cancelledAt: row.cancelledAt,
    acceptedAt: row.acceptedAt,
    deliveredAt: row.deliveredAt,
    failureCode: row.failureCode,
    failureDetail: row.failureDetail,
    recipients,
  };
}

export async function checkSendRate(accountId: string): Promise<void> {
  const minute = await db
    .select({ n: sql<number>`count(*)` })
    .from(outboundMessages)
    .where(
      and(
        eq(outboundMessages.accountId, accountId),
        gte(outboundMessages.createdAt, sql`now() - interval '1 minute'`),
        ne(outboundMessages.transportStatus, "cancelled"),
      ),
    );
  if (Number(minute[0]?.n ?? 0) >= config.send.perMinute) throw tooManyRequests("send rate limit reached for this account");

  const hour = await db
    .select({ n: sql<number>`count(*)` })
    .from(outboundMessages)
    .where(
      and(
        eq(outboundMessages.accountId, accountId),
        gte(outboundMessages.createdAt, sql`now() - interval '1 hour'`),
        ne(outboundMessages.transportStatus, "cancelled"),
      ),
    );
  if (Number(hour[0]?.n ?? 0) >= config.send.perHour) throw tooManyRequests("hourly send rate limit reached for this account");
}

export async function findOutboundMessageIdByDeliveryId(deliveryId: string): Promise<string | null> {
  const rows = await db
    .select({ outboundMessageId: outboundDeliveryEvents.outboundMessageId })
    .from(outboundDeliveryEvents)
    .where(
      sql`${outboundDeliveryEvents.type} = ${"sent"} and ${outboundDeliveryEvents.detail}->>'deliveryId' = ${deliveryId}`,
    )
    .limit(1);
  return rows[0]?.outboundMessageId ?? null;
}