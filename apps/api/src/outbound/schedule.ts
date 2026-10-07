import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { AccessibleAccount } from "../auth/authorize.js";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { outboundAttachments, outboundMessages } from "../db/schema.js";
import type { FullMessage, MailEngine, SendAttachment } from "../engine/types.js";
import { buildOutgoingMessageForUser } from "../mail/messageBuilder.js";
import { badRequest, conflict } from "../lib/errors.js";
import { generateMessageId } from "../lib/messageId.js";
import { templateKeyAllowedForAddress } from "../lib/templatePolicy.js";
import { isCustomTemplateKey } from "../mail/templateService.js";
import { checkSuppressions } from "./delivery.js";
import { loadOutboundAttachmentPayloads, storeOutboundAttachmentPayloads } from "./attachmentPayloadStore.js";
import { checkSendRate, failSendPreparation, insertOutboundAttachments, insertRecipients, reserveSendOperation } from "./queue.js";
import { sanitizeOutboundHeaderValue } from "./relay.js";
import { scheduledSends, type RecurrenceRule } from "./scheduledSchema.js";
import { cloneScheduledEmailToDraft } from "./scheduledStalwart.js";

export interface ScheduleSpec {
  scheduledFor: Date;
  timeZone: string;
  recurrence?: RecurrenceRule | undefined;
}

export interface CreateScheduledSendInput {
  userId: string;
  account: AccessibleAccount;
  engine: MailEngine;
  draft: FullMessage;
  attachments: SendAttachment[];
  bcc?: string[] | undefined;
  templateKey?: string | undefined;
  clientRequestId?: string | undefined;
  schedule: ScheduleSpec;
}

export interface ScheduledSendResult {
  sendId: string;
  status: "scheduled";
  scheduledFor: string;
  seriesId: string;
  recurring: boolean;
  idempotentReplay?: boolean;
}

const pendingStatuses = ["preparing", "queued", "sending", "failed"] as const;

function validateTimeZone(value: string): void {
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date()); }
  catch { throw badRequest("invalid time zone"); }
}

function validateSchedule(schedule: ScheduleSpec): void {
  validateTimeZone(schedule.timeZone);
  if (!Number.isFinite(schedule.scheduledFor.getTime())) throw badRequest("scheduledFor must be a valid date");
  if (schedule.scheduledFor.getTime() < Date.now() + 15_000) throw badRequest("scheduled send time must be in the future");
  if (!schedule.recurrence) return;
  if (!Number.isInteger(schedule.recurrence.interval) || schedule.recurrence.interval < 1 || schedule.recurrence.interval > 365) {
    throw badRequest("recurrence interval must be between 1 and 365");
  }
  if (schedule.recurrence.endAt) {
    const end = new Date(schedule.recurrence.endAt);
    if (!Number.isFinite(end.getTime()) || end <= schedule.scheduledFor) throw badRequest("recurrence end date must be after the first send");
  }
  if (schedule.recurrence.maxOccurrences !== undefined && (!Number.isInteger(schedule.recurrence.maxOccurrences) || schedule.recurrence.maxOccurrences < 2 || schedule.recurrence.maxOccurrences > 1000)) {
    throw badRequest("maxOccurrences must be between 2 and 1000");
  }
}

function preparedRecipients(draft: FullMessage, bcc?: string[]) {
  return {
    to: (draft.to ?? []).map((item) => item.email),
    cc: (draft.cc ?? []).map((item) => item.email),
    bcc: bcc ?? [],
  };
}

export async function createScheduledSendFromDraft(input: CreateScheduledSendInput): Promise<ScheduledSendResult> {
  validateSchedule(input.schedule);
  if (input.account.status !== "active") throw badRequest("account is not active");

  if (input.clientRequestId) {
    const [existing] = await db.select({ id: outboundMessages.id }).from(outboundMessages)
      .where(and(eq(outboundMessages.accountId, input.account.id), eq(outboundMessages.clientRequestId, input.clientRequestId))).limit(1);
    if (existing) {
      const [meta] = await db.select().from(scheduledSends).where(eq(scheduledSends.outboundMessageId, existing.id)).limit(1);
      if (meta) return { sendId: existing.id, status: "scheduled", scheduledFor: meta.scheduledFor.toISOString(), seriesId: meta.seriesId, recurring: meta.kind === "recurring", idempotentReplay: true };
    }
  }

  const recipients = preparedRecipients(input.draft, input.bcc);
  const recipientEmails = [recipients.to, recipients.cc, recipients.bcc].flat();
  if (recipientEmails.length === 0) throw badRequest("at least one recipient is required");
  if (recipientEmails.length > config.send.maxRecipients) throw badRequest(`too many recipients (max ${config.send.maxRecipients})`);
  const suppressed = await checkSuppressions(input.account.organizationId, recipientEmails);
  if (suppressed.length) throw conflict(`recipient is suppressed and cannot receive mail: ${suppressed.join(", ")}`);
  await checkSendRate(input.account.id);

  const requestedTemplateKey = input.templateKey ?? "none";
  if (!isCustomTemplateKey(requestedTemplateKey) && !templateKeyAllowedForAddress(requestedTemplateKey === "bible_reader" ? "bible_reader" : requestedTemplateKey === "gsw_default" ? "gsw_default" : "none", input.account.address)) {
    throw badRequest("template is not available for this mail domain");
  }
  const safeSubject = sanitizeOutboundHeaderValue(input.draft.subject) ?? "";
  const safeReplyTo = sanitizeOutboundHeaderValue(input.draft.headers?.["Reply-To"]);
  const safeInReplyTo = sanitizeOutboundHeaderValue(input.draft.headers?.["In-Reply-To"]);
  const safeReferences = sanitizeOutboundHeaderValue(input.draft.headers?.References);
  const rendered = await buildOutgoingMessageForUser({
    userId: input.userId,
    bodyHtml: input.draft.htmlBody,
    bodyText: input.draft.textBody,
    templateKey: requestedTemplateKey,
    senderName: input.account.displayName ?? undefined,
    senderEmail: input.account.address,
  });
  const templateKey = rendered.templateKey;
  const messageId = sanitizeOutboundHeaderValue(generateMessageId())!;

  // Create a complete Stalwart Email object now while the user's scoped token is
  // available, then keep that object in Drafts until the worker submits it.
  // saveSent is used here because it uploads attachments; the message is moved
  // to Drafts immediately and hidden from Drafts by the virtual Outbox view.
  const staged = await input.engine.saveSent(input.account.id, {
    from: input.account.address,
    to: recipients.to,
    cc: recipients.cc,
    bcc: recipients.bcc,
    subject: safeSubject,
    textBody: rendered.text,
    htmlBody: rendered.html,
    replyTo: safeReplyTo,
    inReplyTo: safeInReplyTo,
    references: safeReferences,
    messageId,
    attachments: input.attachments,
  });
  try {
    await input.engine.move(input.account.id, [staged.engineMessageId], "Drafts");
  } catch (error) {
    try { await input.engine.move(input.account.id, [staged.engineMessageId], "Trash"); } catch {}
    throw new Error("failed to stage scheduled message in Drafts", { cause: error });
  }

  const reserve = await reserveSendOperation({
    accountId: input.account.id,
    fromAddress: input.account.address,
    to: recipients.to,
    cc: recipients.cc,
    bcc: recipients.bcc,
    subject: safeSubject,
    textBody: rendered.text,
    htmlBody: rendered.html,
    templateKey,
    replyTo: safeReplyTo,
    inReplyTo: safeInReplyTo,
    references: safeReferences,
    messageId,
    attachments: input.attachments,
    clientRequestId: input.clientRequestId,
  });

  if (!reserve.reserved) {
    try { await input.engine.move(input.account.id, [staged.engineMessageId], "Trash"); } catch {}
    const [meta] = await db.select().from(scheduledSends).where(eq(scheduledSends.outboundMessageId, reserve.id)).limit(1);
    if (!meta) throw conflict("send operation already exists and is not scheduled");
    return { sendId: reserve.id, status: "scheduled", scheduledFor: meta.scheduledFor.toISOString(), seriesId: meta.seriesId, recurring: meta.kind === "recurring", idempotentReplay: true };
  }

  const seriesId = randomUUID();
  try {
    await insertRecipients(reserve.id, recipients.to, recipients.cc, recipients.bcc);
    await insertOutboundAttachments(reserve.id, input.attachments.map(({ content: _content, ...attachment }) => ({ ...attachment, engineAttachmentId: null })));
    await storeOutboundAttachmentPayloads(reserve.id, input.attachments);
    await db.update(outboundMessages).set({
      transportStatus: "queued",
      engineMessageId: staged.engineMessageId,
      engineThreadId: staged.threadId,
      nextAttemptAt: input.schedule.scheduledFor,
      undoUntil: null,
      preparingStartedAt: new Date(),
    }).where(eq(outboundMessages.id, reserve.id));
    await db.insert(scheduledSends).values({
      outboundMessageId: reserve.id,
      userId: input.userId,
      kind: input.schedule.recurrence ? "recurring" : "once",
      scheduledFor: input.schedule.scheduledFor,
      timeZone: input.schedule.timeZone,
      recurrence: input.schedule.recurrence ?? null,
      seriesId,
      occurrenceIndex: 0,
    });
  } catch (error) {
    await failSendPreparation(reserve.id, "schedule_preparation", error instanceof Error ? error.message : String(error));
    try { await input.engine.move(input.account.id, [staged.engineMessageId], "Trash"); } catch {}
    throw error;
  }

  return {
    sendId: reserve.id,
    status: "scheduled",
    scheduledFor: input.schedule.scheduledFor.toISOString(),
    seriesId,
    recurring: Boolean(input.schedule.recurrence),
  };
}

function zonedParts(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(value);
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: number("year"), month: number("month"), day: number("day"), hour: number("hour"), minute: number("minute"), second: number("second") };
}

function zonedLocalToUtc(parts: ReturnType<typeof zonedParts>, timeZone: string): Date {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let guess = target;
  for (let index = 0; index < 3; index += 1) {
    const observed = zonedParts(new Date(guess), timeZone);
    const observedUtc = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second);
    guess += target - observedUtc;
  }
  return new Date(guess);
}

export function nextOccurrence(current: Date, recurrence: RecurrenceRule, timeZone: string): Date | null {
  const local = zonedParts(current, timeZone);
  const calendar = new Date(Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second));
  if (recurrence.frequency === "monthly") calendar.setUTCMonth(calendar.getUTCMonth() + recurrence.interval);
  else if (recurrence.frequency === "weekly") calendar.setUTCDate(calendar.getUTCDate() + 7 * recurrence.interval);
  else if (recurrence.frequency === "weekdays") {
    do { calendar.setUTCDate(calendar.getUTCDate() + 1); } while (calendar.getUTCDay() === 0 || calendar.getUTCDay() === 6);
  } else calendar.setUTCDate(calendar.getUTCDate() + recurrence.interval);
  const next = zonedLocalToUtc({ year: calendar.getUTCFullYear(), month: calendar.getUTCMonth() + 1, day: calendar.getUTCDate(), hour: local.hour, minute: local.minute, second: local.second }, timeZone);
  if (recurrence.endAt && next > new Date(recurrence.endAt)) return null;
  return next;
}

export async function scheduleNextRecurringOccurrence(outboundMessageId: string): Promise<string | null> {
  const [meta] = await db.select().from(scheduledSends).where(eq(scheduledSends.outboundMessageId, outboundMessageId)).limit(1);
  if (!meta || meta.kind !== "recurring" || !meta.recurrence) return null;
  if (meta.recurrence.maxOccurrences !== undefined && meta.occurrenceIndex + 1 >= meta.recurrence.maxOccurrences) return null;
  const nextAt = nextOccurrence(meta.scheduledFor, meta.recurrence, meta.timeZone);
  if (!nextAt) return null;

  const [source] = await db.select().from(outboundMessages).where(eq(outboundMessages.id, outboundMessageId)).limit(1);
  if (!source?.engineMessageId) throw new Error("recurring source message has no engine message id");
  const messageId = sanitizeOutboundHeaderValue(generateMessageId())!;
  const staged = await cloneScheduledEmailToDraft({ productAccountId: source.accountId, address: source.fromAddress, sourceEmailId: source.engineMessageId, messageId });
  const nextIndex = meta.occurrenceIndex + 1;
  const clientRequestId = `recurring:${meta.seriesId}:${nextIndex}`;
  const reserve = await reserveSendOperation({
    accountId: source.accountId,
    fromAddress: source.fromAddress,
    to: source.to,
    cc: source.cc ?? undefined,
    bcc: source.bcc ?? undefined,
    subject: source.subject ?? undefined,
    textBody: source.textBody ?? undefined,
    htmlBody: source.htmlBody ?? undefined,
    templateKey: source.templateKey,
    replyTo: source.replyTo ?? undefined,
    inReplyTo: source.inReplyTo ?? undefined,
    references: source.references ?? undefined,
    messageId,
    clientRequestId,
  });
  if (!reserve.reserved) return reserve.id;

  try {
    await insertRecipients(reserve.id, source.to, source.cc ?? [], source.bcc ?? []);
    const attachmentRows = await db.select({
      engineAttachmentId: outboundAttachments.engineAttachmentId,
      filename: outboundAttachments.filename,
      contentType: outboundAttachments.contentType,
      size: outboundAttachments.size,
      contentDisposition: outboundAttachments.contentDisposition,
      contentId: outboundAttachments.contentId,
    }).from(outboundAttachments).where(eq(outboundAttachments.outboundMessageId, outboundMessageId));
    await insertOutboundAttachments(reserve.id, attachmentRows);
    const payloads = await loadOutboundAttachmentPayloads(outboundMessageId);
    await storeOutboundAttachmentPayloads(reserve.id, payloads.map((payload) => ({
      filename: payload.filename,
      contentType: payload.contentType,
      size: payload.content.length,
      content: payload.content.toString("base64"),
      contentDisposition: "attachment",
      ...(payload.contentId ? { contentId: payload.contentId } : {}),
    })));
    await db.update(outboundMessages).set({ transportStatus: "queued", engineMessageId: staged.engineMessageId, engineThreadId: staged.engineThreadId, nextAttemptAt: nextAt, undoUntil: null }).where(eq(outboundMessages.id, reserve.id));
    await db.insert(scheduledSends).values({ outboundMessageId: reserve.id, userId: meta.userId, kind: "recurring", scheduledFor: nextAt, timeZone: meta.timeZone, recurrence: meta.recurrence, seriesId: meta.seriesId, occurrenceIndex: nextIndex });
    return reserve.id;
  } catch (error) {
    await failSendPreparation(reserve.id, "recurrence_preparation", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export async function scheduledMetadata(id: string) {
  const [row] = await db.select().from(scheduledSends).where(eq(scheduledSends.outboundMessageId, id)).limit(1);
  return row ?? null;
}

export async function activeScheduledEngineIds(accountId: string): Promise<Set<string>> {
  const rows = await db.select({ engineMessageId: outboundMessages.engineMessageId })
    .from(outboundMessages)
    .innerJoin(scheduledSends, eq(scheduledSends.outboundMessageId, outboundMessages.id))
    .where(and(eq(outboundMessages.accountId, accountId), inArray(outboundMessages.transportStatus, [...pendingStatuses])));
  return new Set(rows.flatMap((row) => row.engineMessageId ? [row.engineMessageId] : []));
}

export async function outboxCount(accountId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(outboundMessages)
    .where(and(eq(outboundMessages.accountId, accountId), inArray(outboundMessages.transportStatus, [...pendingStatuses])));
  return Number(row?.n ?? 0);
}

export async function listOutboxMessages(accountId: string, limit: number, offset: number) {
  const rows = await db.select({ message: outboundMessages, schedule: scheduledSends })
    .from(outboundMessages)
    .leftJoin(scheduledSends, eq(scheduledSends.outboundMessageId, outboundMessages.id))
    .where(and(eq(outboundMessages.accountId, accountId), inArray(outboundMessages.transportStatus, [...pendingStatuses])))
    .orderBy(asc(outboundMessages.nextAttemptAt), asc(outboundMessages.createdAt))
    .limit(limit).offset(offset);
  return rows.map(({ message, schedule }) => ({
    engineId: `outbox:${message.id}`,
    threadId: `outbox:${message.id}`,
    mailbox: "Outbox",
    from: { email: message.fromAddress },
    to: message.to.map((email) => ({ email })),
    cc: (message.cc ?? []).map((email) => ({ email })),
    subject: message.subject ?? "",
    snippet: schedule
      ? `${schedule.kind === "recurring" ? "Recurring" : "Scheduled"} · ${schedule.scheduledFor.toISOString()}`
      : message.transportStatus === "failed" ? `Send failed · ${message.failureDetail ?? "Retry available"}` : `Waiting to send · ${message.transportStatus}`,
    date: (schedule?.scheduledFor ?? message.nextAttemptAt ?? message.createdAt).toISOString(),
    size: 0,
    read: true,
    flagged: false,
    hasAttachments: false,
    keywords: [],
  }));
}

export async function getOutboxMessage(accountId: string, virtualId: string) {
  if (!virtualId.startsWith("outbox:")) return null;
  const id = virtualId.slice("outbox:".length);
  const [row] = await db.select({ message: outboundMessages, schedule: scheduledSends })
    .from(outboundMessages).leftJoin(scheduledSends, eq(scheduledSends.outboundMessageId, outboundMessages.id))
    .where(and(eq(outboundMessages.id, id), eq(outboundMessages.accountId, accountId))).limit(1);
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
    date: (schedule?.scheduledFor ?? message.nextAttemptAt ?? message.createdAt).toISOString(),
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
      "X-GSW-Transport-Status": message.transportStatus,
      ...(schedule ? { "X-GSW-Schedule-Kind": schedule.kind, "X-GSW-Time-Zone": schedule.timeZone, "X-GSW-Scheduled-For": schedule.scheduledFor.toISOString() } : {}),
    },
  };
}
