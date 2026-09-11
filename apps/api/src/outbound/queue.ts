import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { outboundDeliveryEvents, outboundMessages } from "../db/schema.js";
import type { OutboundJob } from "./types.js";

export interface EnqueueInput {
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
}

export async function enqueueOutbound(input: EnqueueInput): Promise<string> {
  const rows = await db
    .insert(outboundMessages)
    .values({
      accountId: input.accountId,
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
    })
    .returning({ id: outboundMessages.id });
  const row = rows[0];
  if (!row) throw new Error("failed to enqueue outbound message");
  return row.id;
}

const reclaimWindow = sql`now() - interval '5 minutes'`;

export async function claimDueJobs(limit: number): Promise<{ id: string; accountId: string }[]> {
  const due = await db
    .select({ id: outboundMessages.id, accountId: outboundMessages.accountId })
    .from(outboundMessages)
    .where(
      or(
        eq(outboundMessages.status, "queued"),
        and(eq(outboundMessages.status, "sending"), lte(outboundMessages.updatedAt, reclaimWindow)),
        and(eq(outboundMessages.status, "deferred"), lte(outboundMessages.nextAttemptAt, sql`now()`)),
      ),
    )
    .orderBy(asc(outboundMessages.createdAt))
    .limit(limit)
    .for("update", { skipLocked: true });

  if (due.length === 0) return [];

  const claimed = await db
    .update(outboundMessages)
    .set({
      status: "sending",
      attempts: sql`${outboundMessages.attempts} + 1`,
      nextAttemptAt: null,
      lastError: null,
    })
    .where(inArray(outboundMessages.id, due.map((d) => d.id)))
    .returning({ id: outboundMessages.id, accountId: outboundMessages.accountId });

  return claimed;
}

export async function loadJob(id: string): Promise<OutboundJob | null> {
  const rows = await db.select().from(outboundMessages).where(eq(outboundMessages.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;
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
  };
}

export async function markSent(id: string, deliveryId?: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(outboundMessages).set({ status: "sent" }).where(eq(outboundMessages.id, id));
    await tx.insert(outboundDeliveryEvents).values({
      outboundMessageId: id,
      type: "sent",
      detail: deliveryId ? { deliveryId } : {},
    });
  });
}

export async function markDeferred(id: string, message: string): Promise<void> {
  const rows = await db.select({ maxAttempts: outboundMessages.maxAttempts }).from(outboundMessages).where(eq(outboundMessages.id, id)).limit(1);
  const maxAttempts = rows[0]?.maxAttempts ?? 5;
  const attempts = await attemptCount(id);
  await db.transaction(async (tx) => {
    await tx
      .update(outboundMessages)
      .set({
        status: "queued",
        lastError: message,
        nextAttemptAt: sql`now() + (${attempts} * interval '30 seconds')`,
      })
      .where(eq(outboundMessages.id, id));
    await tx.insert(outboundDeliveryEvents).values({ outboundMessageId: id, type: "deferred", detail: { message } });
  });
  if (attempts >= maxAttempts) {
    await markFailed(id, `max attempts (${maxAttempts}) reached: ${message}`);
  }
}

export async function markFailed(id: string, message: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(outboundMessages).set({ status: "failed", lastError: message }).where(eq(outboundMessages.id, id));
    await tx.insert(outboundDeliveryEvents).values({ outboundMessageId: id, type: "failed", detail: { message } });
  });
}

async function attemptCount(id: string): Promise<number> {
  const rows = await db
    .select({ attempts: outboundMessages.attempts })
    .from(outboundMessages)
    .where(eq(outboundMessages.id, id))
    .limit(1);
  return rows[0]?.attempts ?? 1;
}