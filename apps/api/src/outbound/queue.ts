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
  clientRequestId?: string | undefined;
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
      clientRequestId: input.clientRequestId,
    })
    .returning({ id: outboundMessages.id });
  const row = rows[0];
  if (!row) throw new Error("failed to enqueue outbound message");
  return row.id;
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
          eq(outboundMessages.status, "queued"),
          and(eq(outboundMessages.status, "sending"), lte(outboundMessages.updatedAt, reclaimWindow)),
          and(eq(outboundMessages.status, "deferred"), lte(outboundMessages.nextAttemptAt, sql`now()`)),
        ),
      )
      .orderBy(asc(outboundMessages.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true });

    if (due.length === 0) return [];

    return tx
      .update(outboundMessages)
      .set({
        status: "sending",
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
  const rows = await db
    .select({ attempts: outboundMessages.attempts, maxAttempts: outboundMessages.maxAttempts })
    .from(outboundMessages)
    .where(eq(outboundMessages.id, id))
    .limit(1);
  const attempts = rows[0]?.attempts ?? 1;
  const maxAttempts = rows[0]?.maxAttempts ?? 5;
  if (attempts >= maxAttempts) {
    return markFailed(id, `max attempts (${maxAttempts}) reached: ${message}`);
  }
  const seconds = backoffSteps[Math.min(attempts - 1, backoffSteps.length - 1)] ?? 240;
  await db.transaction(async (tx) => {
    await tx
      .update(outboundMessages)
      .set({
        status: "deferred",
        lastError: message,
        nextAttemptAt: sql`now() + (${seconds} * interval '1 second')`,
      })
      .where(eq(outboundMessages.id, id));
    await tx.insert(outboundDeliveryEvents).values({ outboundMessageId: id, type: "deferred", detail: { message } });
  });
}

export async function markFailed(id: string, message: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(outboundMessages).set({ status: "failed", lastError: message }).where(eq(outboundMessages.id, id));
    await tx.insert(outboundDeliveryEvents).values({ outboundMessageId: id, type: "failed", detail: { message } });
  });
}