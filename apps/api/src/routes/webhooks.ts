import { createHmac, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { deliveryEventType, outboundDeliveryEvents, outboundMessages } from "../db/schema.js";
import { badRequest, unauthorized } from "../lib/errors.js";

type DeliveryEventType = (typeof deliveryEventType.enumValues)[number];

interface ResendPayload {
  id?: unknown;
  type?: unknown;
  data?: { id?: unknown; to?: unknown; from?: unknown; subject?: unknown; bounce?: unknown; complaint?: unknown };
}

const toDeliveryType = (providerType: string): DeliveryEventType | null => {
  switch (providerType) {
    case "email.sent":
      return "sent";
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

export default fp(async (app: FastifyInstance) => {
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

    const type = toDeliveryType(String(payload.type ?? ""));
    const providerEventId = String(payload.id ?? "");
    const deliveryId = String(payload.data?.id ?? "");
    if (!type || !providerEventId || !deliveryId) {
      return { received: true, ignored: true };
    }

    const match = await db
      .select({ outboundMessageId: outboundDeliveryEvents.outboundMessageId })
      .from(outboundDeliveryEvents)
      .where(
        sql`${outboundDeliveryEvents.type} = ${"sent"} and ${outboundDeliveryEvents.detail}->>'deliveryId' = ${deliveryId}`,
      )
      .limit(1);
    const messageId = match[0]?.outboundMessageId;
    if (!messageId) {
      return { received: true, ignored: "unknown deliveryId" };
    }

    await db.transaction(async (tx) => {
      await tx
        .insert(outboundDeliveryEvents)
        .values({
          outboundMessageId: messageId,
          type,
          providerEventId,
          detail: { providerType: payload.type },
        })
        .onConflictDoNothing({ target: outboundDeliveryEvents.providerEventId });
      if (type === "delivered" || type === "bounced") {
        await tx.update(outboundMessages).set({ status: type }).where(eq(outboundMessages.id, messageId));
      }
    });

    return { received: true };
  });
});