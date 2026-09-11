import { and, eq, inArray, sql } from "drizzle-orm";
import type { recipientDeliveryStatus } from "../db/schema.js";
import { db } from "../db/client.js";
import { deliverySuppressions, outboundMessages, outboundRecipients } from "../db/schema.js";
import type { suppressionReason } from "../db/schema.js";

type RecipientStatus = (typeof recipientDeliveryStatus.enumValues)[number];

export type DerivedDelivery = (typeof outboundMessages.$inferSelect)["deliveryStatus"];

export function deriveDeliveryStatus(statuses: RecipientStatus[]): DerivedDelivery {
  if (statuses.length === 0) return "pending";
  const delivered = statuses.filter((s) => s === "delivered").length;
  const bounced = statuses.filter((s) => s === "bounced").length;
  const complained = statuses.filter((s) => s === "complained").length;
  const deferred = statuses.filter((s) => s === "deferred").length;
  const pending = statuses.length - (delivered + bounced + complained + deferred);

  if (bounced > 0 || complained > 0) {
    if (delivered > 0) return "partial_failure";
    if (complained > 0 && bounced === 0) return "complained";
    return "bounced";
  }
  if (deferred > 0) return "deferred";
  if (pending > 0) return "pending";
  return "delivered";
}

export async function applyRecipientEvent(
  outboundMessageId: string,
  emails: string[],
  status: RecipientStatus,
): Promise<DerivedDelivery> {
  const unique = [...new Set(emails.map((e) => e.toLowerCase()))];
  if (unique.length > 0) {
    await db
      .update(outboundRecipients)
      .set({ deliveryStatus: status, lastEventAt: sql`now()` })
      .where(
        and(
          eq(outboundRecipients.outboundMessageId, outboundMessageId),
          inArray(outboundRecipients.email, unique),
        ),
      );
  }

  const rows = await db
    .select({ deliveryStatus: outboundRecipients.deliveryStatus })
    .from(outboundRecipients)
    .where(eq(outboundRecipients.outboundMessageId, outboundMessageId));
  const derived = deriveDeliveryStatus(rows.map((r) => r.deliveryStatus));

  await db
    .update(outboundMessages)
    .set({
      deliveryStatus: derived,
      ...(derived === "delivered" ? { deliveredAt: sql`now()` } : {}),
    })
    .where(eq(outboundMessages.id, outboundMessageId));

  return derived;
}

export async function checkSuppressions(organizationId: string, emails: string[]): Promise<string[]> {
  if (emails.length === 0) return [];
  const rows = await db
    .select({ email: deliverySuppressions.email })
    .from(deliverySuppressions)
    .where(
      and(
        eq(deliverySuppressions.organizationId, organizationId),
        inArray(deliverySuppressions.email, emails),
      ),
    );
  return rows.map((r) => r.email);
}

export async function recordSuppression(
  organizationId: string,
  email: string,
  reason: (typeof suppressionReason.enumValues)[number],
  source: string,
): Promise<void> {
  await db
    .insert(deliverySuppressions)
    .values({ organizationId, email: email.toLowerCase(), reason, source })
    .onConflictDoNothing({ target: [deliverySuppressions.organizationId, deliverySuppressions.email] });
}