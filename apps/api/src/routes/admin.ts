import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { z } from "zod";
import { requireOrgAdminAny, resolveAdminOrg } from "../auth/authorize.js";
import { requireUser } from "../auth/middleware.js";
import { db, pingDatabase } from "../db/client.js";
import { auditEvents, inboundMessages, outboundMessages } from "../db/schema.js";
import { getEngine } from "../engine/index.js";
import { getRelay } from "../outbound/relay.js";

const todayStart = sql`date_trunc('day', now())`;

export default fp(async (app: FastifyInstance) => {
  app.register(requireUser, { optional: false });

  app.get("/admin/health", async (req) => {
    await requireOrgAdminAny(req.user!.id);
    const [dbOk, engine, relay] = await Promise.all([pingDatabase(), getEngine().status(), Promise.resolve(getRelay().name)]);
    return {
      ok: dbOk && engine.ok,
      db: dbOk ? "ok" : "down",
      mailEngine: engine,
      outboundRelay: relay,
    };
  });

  app.get("/admin/stats", async (req) => {
    await requireOrgAdminAny(req.user!.id);
    const byTransport = await db
      .select({ transportStatus: outboundMessages.transportStatus, n: count() })
      .from(outboundMessages)
      .groupBy(outboundMessages.transportStatus);
    const byDelivery = await db
      .select({ deliveryStatus: outboundMessages.deliveryStatus, n: count() })
      .from(outboundMessages)
      .groupBy(outboundMessages.deliveryStatus);

    const [messagesToday, spamToday] = await Promise.all([
      db.select({ n: count() }).from(inboundMessages).where(gte(inboundMessages.date, todayStart)),
      db
        .select({ n: count() })
        .from(inboundMessages)
        .where(and(gte(inboundMessages.date, todayStart), gte(inboundMessages.spamScore, sql`5`))),
    ]);

    const outboundQueue = byTransport.find((s) => s.transportStatus === "queued")?.n ?? 0;
    const sending = byTransport.find((s) => s.transportStatus === "sending")?.n ?? 0;
    const failed = byTransport.find((s) => s.transportStatus === "failed")?.n ?? 0;
    const cancelled = byTransport.find((s) => s.transportStatus === "cancelled")?.n ?? 0;
    const deferred = byDelivery.find((s) => s.deliveryStatus === "deferred")?.n ?? 0;

    return {
      outboundQueue,
      sending,
      failed,
      cancelled,
      deferred,
      byTransport,
      byDelivery,
      spamBlockedToday: spamToday[0]?.n ?? 0,
      messagesToday: messagesToday[0]?.n ?? 0,
    };
  });

  app.get("/admin/outbound", async (req) => {
    await requireOrgAdminAny(req.user!.id);
    const rows = await db
      .select({
        id: outboundMessages.id,
        fromAddress: outboundMessages.fromAddress,
        to: outboundMessages.to,
        subject: outboundMessages.subject,
        transportStatus: outboundMessages.transportStatus,
        deliveryStatus: outboundMessages.deliveryStatus,
        attempts: outboundMessages.attempts,
        nextAttemptAt: outboundMessages.nextAttemptAt,
        failureCode: outboundMessages.failureCode,
        failureDetail: outboundMessages.failureDetail,
        createdAt: outboundMessages.createdAt,
      })
      .from(outboundMessages)
      .orderBy(desc(outboundMessages.createdAt))
      .limit(50);
    return { outbound: rows };
  });

  app.get("/admin/audit", async (req) => {
    const input = z
      .object({
        organizationId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      })
      .parse(req.query ?? {});
    const organizationId = await resolveAdminOrg(req.user!.id, input.organizationId);
    const events = await db
      .select({
        id: auditEvents.id,
        actorUserId: auditEvents.actorUserId,
        action: auditEvents.action,
        resourceType: auditEvents.resourceType,
        resourceId: auditEvents.resourceId,
        metadata: auditEvents.metadata,
        ipAddress: auditEvents.ipAddress,
        userAgent: auditEvents.userAgent,
        createdAt: auditEvents.createdAt,
      })
      .from(auditEvents)
      .where(eq(auditEvents.organizationId, organizationId))
      .orderBy(desc(auditEvents.createdAt))
      .limit(input.limit ?? 100)
      .offset(input.offset ?? 0);
    return { organizationId, events };
  });
});