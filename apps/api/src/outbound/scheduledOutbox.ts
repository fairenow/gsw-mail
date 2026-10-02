import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { outboundMessages, outboundRecipients } from "../db/schema.js";
import { scheduledSends } from "./scheduledSchema.js";

const activeScheduledStatuses = ["preparing", "queued", "sending", "failed"] as const;

export async function scheduledOutboxCount(accountId: string): Promise<number> {
  const rows = await db.select({ id: outboundMessages.id })
    .from(outboundMessages)
    .innerJoin(scheduledSends, eq(scheduledSends.outboundMessageId, outboundMessages.id))
    .where(and(
      eq(outboundMessages.accountId, accountId),
      inArray(outboundMessages.transportStatus, [...activeScheduledStatuses]),
    ));
  return rows.length;
}

export async function listScheduledOutboxMessages(accountId: string, limit: number, offset: number) {
  const rows = await db.select({ message: outboundMessages, schedule: scheduledSends })
    .from(outboundMessages)
    .innerJoin(scheduledSends, eq(scheduledSends.outboundMessageId, outboundMessages.id))
    .where(and(
      eq(outboundMessages.accountId, accountId),
      inArray(outboundMessages.transportStatus, [...activeScheduledStatuses]),
    ))
    .orderBy(asc(scheduledSends.scheduledFor), asc(outboundMessages.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map(({ message, schedule }) => ({
    engineId: `outbox:${message.id}`,
    threadId: `outbox:${message.id}`,
    mailbox: "Outbox",
    from: { email: message.fromAddress },
    to: message.to.map((email) => ({ email })),
    cc: (message.cc ?? []).map((email) => ({ email })),
    subject: message.subject ?? "",
    snippet: `${schedule.kind === "recurring" ? "Recurring" : "Scheduled"} · ${schedule.scheduledFor.toISOString()}`,
    date: schedule.scheduledFor.toISOString(),
    size: 0,
    read: true,
    flagged: false,
    hasAttachments: false,
    keywords: [],
  }));
}

export async function getScheduledOutboxMessage(accountId: string, virtualId: string) {
  if (!virtualId.startsWith("outbox:")) return null;
  const id = virtualId.slice("outbox:".length);
  const [row] = await db.select({ message: outboundMessages, schedule: scheduledSends })
    .from(outboundMessages)
    .innerJoin(scheduledSends, eq(scheduledSends.outboundMessageId, outboundMessages.id))
    .where(and(
      eq(outboundMessages.id, id),
      eq(outboundMessages.accountId, accountId),
      inArray(outboundMessages.transportStatus, [...activeScheduledStatuses]),
    ))
    .limit(1);
  if (!row) return null;

  const { message, schedule } = row;
  return {
    engineId: virtualId,
    threadId: virtualId,
    mailbox: "Outbox",
    from: { email: message.fromAddress },
    to: message.to.map((email) => ({ email })),
    cc: (message.cc ?? []).map((email) => ({ email })),
    subject: message.subject ?? "",
    snippet: message.textBody?.replace(/\s+/g, " ").trim().slice(0, 200) ?? "",
    date: schedule.scheduledFor.toISOString(),
    size: 0,
    read: true,
    flagged: false,
    hasAttachments: false,
    keywords: [],
    textBody: message.textBody ?? undefined,
    htmlBody: message.htmlBody ?? undefined,
    attachments: [],
    headers: {
      "X-GSW-Send-ID": message.id,
      "X-GSW-Draft-ID": message.engineMessageId ?? "",
      "X-GSW-Transport-Status": message.transportStatus,
      "X-GSW-Schedule-Kind": schedule.kind,
      "X-GSW-Time-Zone": schedule.timeZone,
      "X-GSW-Scheduled-For": schedule.scheduledFor.toISOString(),
      "X-GSW-Series-ID": schedule.seriesId,
    },
  };
}

export async function syncScheduledDraftEdit(input: {
  accountId: string;
  previousEngineId: string;
  engineId: string;
  to: string[];
  cc?: string[] | undefined;
  bcc?: string[] | undefined;
  subject?: string | undefined;
  textBody?: string | undefined;
  htmlBody?: string | undefined;
  replyTo?: string | undefined;
  inReplyTo?: string | undefined;
  references?: string | undefined;
  templateKey?: string | undefined;
}): Promise<boolean> {
  const [scheduled] = await db.select({ id: outboundMessages.id })
    .from(outboundMessages)
    .innerJoin(scheduledSends, eq(scheduledSends.outboundMessageId, outboundMessages.id))
    .where(and(
      eq(outboundMessages.accountId, input.accountId),
      eq(outboundMessages.engineMessageId, input.previousEngineId),
      inArray(outboundMessages.transportStatus, [...activeScheduledStatuses]),
    ))
    .limit(1);
  if (!scheduled) return false;

  await db.transaction(async (tx) => {
    await tx.update(outboundMessages).set({
      engineMessageId: input.engineId,
      to: input.to,
      cc: input.cc ?? [],
      bcc: input.bcc ?? [],
      subject: input.subject ?? "",
      textBody: input.textBody ?? null,
      htmlBody: input.htmlBody ?? null,
      replyTo: input.replyTo ?? null,
      inReplyTo: input.inReplyTo ?? null,
      references: input.references ?? null,
      ...(input.templateKey ? { templateKey: input.templateKey } : {}),
    }).where(eq(outboundMessages.id, scheduled.id));

    await tx.delete(outboundRecipients).where(eq(outboundRecipients.outboundMessageId, scheduled.id));
    const recipients = [
      ...input.to.map((email) => ({ outboundMessageId: scheduled.id, email, recipientType: "to" as const })),
      ...(input.cc ?? []).map((email) => ({ outboundMessageId: scheduled.id, email, recipientType: "cc" as const })),
      ...(input.bcc ?? []).map((email) => ({ outboundMessageId: scheduled.id, email, recipientType: "bcc" as const })),
    ];
    if (recipients.length) await tx.insert(outboundRecipients).values(recipients);
  });

  return true;
}
