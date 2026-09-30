import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { domains, emailAccounts, outboundDeliveryEvents, outboundMessages, outboundRecipients } from "../db/schema.js";
import { recordSuppression } from "./delivery.js";

export type StalwartDeliveryDisposition = "queued" | "delivered" | "deferred" | "bounced" | "completed";

const trackedEventTypes = new Map<string, StalwartDeliveryDisposition>([
  ["queue.authenticated-message-queued", "queued"],
  ["queue.message-queued", "queued"],
  ["delivery.delivered", "delivered"],
  ["delivery.failed", "deferred"],
  ["delivery.rcpt-to-failed", "deferred"],
  ["delivery.dsn-temp-fail", "deferred"],
  ["delivery.rcpt-to-rejected", "bounced"],
  ["delivery.message-rejected", "bounced"],
  ["delivery.null-mx", "bounced"],
  ["delivery.dsn-perm-fail", "bounced"],
  ["delivery.completed", "completed"],
]);

const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function stringsFrom(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsFrom);
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(stringsFrom);
  return [];
}

function firstString(value: unknown): string | null {
  return stringsFrom(value).map((item) => item.trim()).find(Boolean) ?? null;
}

function emailAddresses(value: unknown): string[] {
  const values = new Set<string>();
  for (const candidate of stringsFrom(value)) {
    for (const match of candidate.match(emailPattern) ?? []) values.add(match.toLowerCase());
  }
  return [...values];
}

function sameAddressSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const expected = new Set(left.map((value) => value.toLowerCase()));
  return right.every((value) => expected.has(value.toLowerCase()));
}

function messageIdCandidates(value: unknown): string[] {
  const raw = firstString(value);
  if (!raw) return [];
  const trimmed = raw.trim();
  const unwrapped = trimmed.replace(/^<|>$/g, "");
  return [...new Set([trimmed, unwrapped, `<${unwrapped}>`])];
}

export function classifyStalwartDeliveryEvent(eventType: string): StalwartDeliveryDisposition | null {
  return trackedEventTypes.get(eventType) ?? null;
}

export function isStalwartOutboundDeliveryEvent(eventType: string): boolean {
  return trackedEventTypes.has(eventType);
}

function eventDetail(eventType: string, data: Record<string, unknown>): Record<string, unknown> {
  const fields = ["queueId", "messageId", "from", "to", "code", "reason", "details", "hostname", "domain", "remoteIp"] as const;
  const detail: Record<string, unknown> = { sourceEventType: eventType };
  for (const field of fields) {
    if (data[field] !== undefined) detail[field] = data[field];
  }
  return detail;
}

async function findRecentOutboundByEnvelope(data: Record<string, unknown>): Promise<string | null> {
  const sender = emailAddresses(data.from)[0];
  const eventRecipients = emailAddresses(data.to);
  if (!sender || !eventRecipients.length) return null;

  const candidates = await db
    .select({ id: outboundMessages.id })
    .from(outboundMessages)
    .where(and(
      sql`lower(${outboundMessages.fromAddress}) = ${sender.toLowerCase()}`,
      gte(outboundMessages.createdAt, sql`now() - interval '10 minutes'`),
      inArray(outboundMessages.transportStatus, ["sending", "accepted"]),
    ))
    .orderBy(desc(outboundMessages.createdAt))
    .limit(12);

  const matches: string[] = [];
  for (const candidate of candidates) {
    const rows = await db
      .select({ email: outboundRecipients.email })
      .from(outboundRecipients)
      .where(eq(outboundRecipients.outboundMessageId, candidate.id));
    const candidateRecipients = rows.map((row) => row.email.toLowerCase());
    if (sameAddressSet(eventRecipients, candidateRecipients)) matches.push(candidate.id);
  }
  return matches.length === 1 ? matches[0]! : null;
}

async function findOutboundMessageId(data: Record<string, unknown>): Promise<string | null> {
  const candidates = messageIdCandidates(data.messageId);
  if (candidates.length) {
    const rows = await db
      .select({ id: outboundMessages.id })
      .from(outboundMessages)
      .where(or(...candidates.map((candidate) => eq(outboundMessages.messageId, candidate))))
      .limit(2);
    if (rows.length === 1) return rows[0]!.id;
  }

  const queueId = firstString(data.queueId);
  if (queueId) {
    const rows = await db
      .select({ outboundMessageId: outboundDeliveryEvents.outboundMessageId })
      .from(outboundDeliveryEvents)
      .where(sql`${outboundDeliveryEvents.detail}->>'queueId' = ${queueId}`)
      .limit(2);
    if (rows.length === 1) return rows[0]!.outboundMessageId;
  }

  return findRecentOutboundByEnvelope(data);
}

async function recipientTargets(outboundMessageId: string, data: Record<string, unknown>): Promise<string[]> {
  const explicit = emailAddresses(data.to);
  if (explicit.length) return explicit;
  const rows = await db
    .select({ email: outboundRecipients.email })
    .from(outboundRecipients)
    .where(eq(outboundRecipients.outboundMessageId, outboundMessageId))
    .limit(2);
  return rows.length === 1 ? [rows[0]!.email.toLowerCase()] : [];
}

async function organizationIdForSend(outboundMessageId: string): Promise<string | null> {
  const rows = await db
    .select({ organizationId: domains.organizationId })
    .from(outboundMessages)
    .innerJoin(emailAccounts, eq(outboundMessages.accountId, emailAccounts.id))
    .innerJoin(domains, eq(emailAccounts.domainId, domains.id))
    .where(eq(outboundMessages.id, outboundMessageId))
    .limit(1);
  return rows[0]?.organizationId ?? null;
}

async function recomputeMessageDelivery(outboundMessageId: string): Promise<void> {
  const recipients = await db
    .select({ status: outboundRecipients.deliveryStatus })
    .from(outboundRecipients)
    .where(eq(outboundRecipients.outboundMessageId, outboundMessageId));
  if (!recipients.length) return;

  const statuses = recipients.map((row) => row.status);
  const allDelivered = statuses.every((status) => status === "delivered");
  const allBounced = statuses.every((status) => status === "bounced");
  const terminal = statuses.every((status) => status === "delivered" || status === "bounced" || status === "complained");
  const anyBounced = statuses.some((status) => status === "bounced");
  const anyComplained = statuses.some((status) => status === "complained");
  const anyDeferred = statuses.some((status) => status === "deferred");

  const deliveryStatus = allDelivered
    ? "delivered"
    : allBounced
      ? "bounced"
      : terminal && (anyBounced || anyComplained)
        ? "partial_failure"
        : anyDeferred
          ? "deferred"
          : "pending";

  await db
    .update(outboundMessages)
    .set({
      deliveryStatus,
      ...(allDelivered ? { deliveredAt: sql`now()` } : {}),
    })
    .where(eq(outboundMessages.id, outboundMessageId));
}

export async function recordStalwartDeliveryEvent(input: {
  eventId: string;
  eventType: string;
  createdAt?: unknown;
  data: Record<string, unknown>;
}): Promise<{ matched: boolean; duplicate: boolean; outboundMessageId?: string; disposition?: StalwartDeliveryDisposition; recipients?: string[] }> {
  const disposition = classifyStalwartDeliveryEvent(input.eventType);
  if (!disposition) return { matched: false, duplicate: false };

  const outboundMessageId = await findOutboundMessageId(input.data);
  if (!outboundMessageId) return { matched: false, duplicate: false, disposition };

  const at = typeof input.createdAt === "string" && !Number.isNaN(Date.parse(input.createdAt))
    ? new Date(input.createdAt)
    : new Date();
  const inserted = await db
    .insert(outboundDeliveryEvents)
    .values({
      outboundMessageId,
      type: disposition === "queued" ? "sent" : disposition === "completed" ? "sent" : disposition,
      detail: eventDetail(input.eventType, input.data),
      providerEventId: input.eventId,
      at,
    })
    .onConflictDoNothing({ target: outboundDeliveryEvents.providerEventId })
    .returning({ id: outboundDeliveryEvents.id });
  if (!inserted.length) return { matched: true, duplicate: true, outboundMessageId, disposition };

  if (disposition === "queued" || disposition === "completed") {
    await recomputeMessageDelivery(outboundMessageId);
    return { matched: true, duplicate: false, outboundMessageId, disposition, recipients: [] };
  }

  const recipients = await recipientTargets(outboundMessageId, input.data);
  if (recipients.length) {
    await db
      .update(outboundRecipients)
      .set({
        deliveryStatus: disposition,
        lastEventAt: at,
        detail: eventDetail(input.eventType, input.data),
      })
      .where(and(
        eq(outboundRecipients.outboundMessageId, outboundMessageId),
        or(...recipients.map((recipient) => sql`lower(${outboundRecipients.email}) = ${recipient.toLowerCase()}`)),
      ));
  }

  if (disposition === "bounced" && recipients.length) {
    const organizationId = await organizationIdForSend(outboundMessageId);
    if (organizationId) {
      for (const recipient of recipients) {
        await recordSuppression(organizationId, recipient, "hard_bounce", `stalwart:${input.eventId}`);
      }
    }
  }

  await recomputeMessageDelivery(outboundMessageId);
  return { matched: true, duplicate: false, outboundMessageId, disposition, recipients };
}
