import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { domains, emailAccounts, outboundDeliveryEvents, outboundMessages } from "../db/schema.js";
import { badRequest, unauthorized } from "../lib/errors.js";
import { applyRecipientEvent, recordSuppression } from "../outbound/delivery.js";
import { findOutboundMessageIdByDeliveryId } from "../outbound/queue.js";

interface ResendPayload {
  id?: unknown;
  type?: unknown;
  data?: {
    id?: unknown;
    email_id?: unknown;
    to?: unknown;
    from?: unknown;
    subject?: unknown;
    bounce?: unknown;
    complaint?: unknown;
  };
}

const toRecipientStatus = (
  providerType: string,
): "delivered" | "deferred" | "bounced" | "complained" | null => {
  switch (providerType) {
    case "email.delivered":
      return "delivered";
    case "email.deferred":
      return "deferred";
    case "email.bounced":
      return "bounced";
    case "email.complained":
      return "complained";
    default:
      return null;
  }
};

const toEmails = (value: unknown): string[] => {
  if (typeof value === "string") return [value.trim().toLowerCase()].filter(Boolean);
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string").map((v) => v.trim().toLowerCase());
  return [];
};

const suppressionReasonFor = (providerType: string): "hard_bounce" | "complaint" | null => {
  if (providerType === "email.bounced") return "hard_bounce";
  if (providerType === "email.complained") return "complaint";
  return null;
};

const hmacKey = (secret: string): Buffer =>
  secret.startsWith("whsec_") ? Buffer.from(secret.slice("whsec_".length), "base64") : Buffer.from(secret, "utf8");

function verifySvix(req: FastifyRequest, raw: Buffer): boolean {
  const headerId = req.headers["svix-id"];
  const headerTimestamp = req.headers["svix-timestamp"];
  const headerSignature = req.headers["svix-signature"];
  if (!headerId || !headerTimestamp || !headerSignature || !config.deliveryWebhookSecret) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const timestamp = Number(headerTimestamp);
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > 300) return false;

  const signed = Buffer.from(`${String(headerId)}.${String(headerTimestamp)}.${raw.toString("utf8")}`);
  const expected = createHmac("sha256", hmacKey(config.deliveryWebhookSecret)).update(signed).digest("base64");
  const expectedBytes = Buffer.from(expected, "base64");

  const candidates = String(headerSignature).split(" ");
  for (const candidate of candidates) {
    const part = candidate.split(",")[1];
    if (!part) continue;
    const offered = Buffer.from(part, "base64");
    if (offered.length === expectedBytes.length && timingSafeEqual(offered, expectedBytes)) return true;
  }
  return false;
}

export default async (app: FastifyInstance) => {
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  app.post("/webhooks/delivery", async (req) => {
    const raw = req.body as Buffer;
    if (config.deliveryWebhookSecret) {
      if (!verifySvix(req, raw)) throw unauthorized("invalid webhook signature");
    } else {
      app.log.warn("[webhooks] DELIVERY_WEBHOOK_SECRET not configured; delivery webhook accepted unsigned");
    }

    let payload: ResendPayload;
    try {
      payload = JSON.parse(raw.toString("utf8")) as ResendPayload;
    } catch {
      throw badRequest("invalid JSON body");
    }

    const providerType = String(payload.type ?? "");
    const recipientStatus = toRecipientStatus(providerType);
    const providerEventId = String(req.headers["svix-id"] ?? payload.id ?? "");
    const deliveryId = String(payload.data?.email_id ?? payload.data?.id ?? "");
    if (!recipientStatus || !providerEventId || !deliveryId) {
      return { received: true, ignored: true };
    }
    const emails = toEmails(payload.data?.to);
    if (emails.length === 0) {
      return { received: true, ignored: "no recipient address" };
    }

    const messageId = await findOutboundMessageIdByDeliveryId(deliveryId);
    if (!messageId) {
      return { received: true, ignored: "unknown deliveryId" };
    }

    const orgInfo = await db
      .select({ organizationId: domains.organizationId })
      .from(outboundMessages)
      .innerJoin(emailAccounts, eq(outboundMessages.accountId, emailAccounts.id))
      .innerJoin(domains, eq(emailAccounts.domainId, domains.id))
      .where(eq(outboundMessages.id, messageId))
      .limit(1);
    const organizationId = orgInfo[0]?.organizationId;
    if (!organizationId) {
      return { received: true, ignored: "unknown organization" };
    }

    await db
      .insert(outboundDeliveryEvents)
      .values({
        outboundMessageId: messageId,
        type: providerType === "email.delivered" ? "delivered" : recipientStatus,
        providerEventId,
        detail: { providerType, deliveryId, emails },
      })
      .onConflictDoNothing({ target: outboundDeliveryEvents.providerEventId });

    const reason = suppressionReasonFor(providerType);
    if (reason) {
      for (const email of emails) {
        await recordSuppression(organizationId, email, reason, `resend:${providerEventId}`);
      }
    }

    await applyRecipientEvent(messageId, emails, recipientStatus);

    return { received: true, messageId, deliveryStatus: recipientStatus };
  });
};