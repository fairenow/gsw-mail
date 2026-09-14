import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireOrgPermission } from "../auth/authorize.js";
import { requireUser } from "../auth/middleware.js";
import { db, pingDatabase } from "../db/client.js";
import { auditEvents, domains, emailAccounts, inboundMessages, outboundMessages } from "../db/schema.js";
import { config } from "../config.js";
import { getRelay } from "../outbound/relay.js";

const orgQuery = z.object({ organizationId: z.string().uuid() });

const todayStart = sql`date_trunc('day', now())`;

export default async (app: FastifyInstance) => {
  await requireUser(app, { optional: false });

  const orgAccountIds = async (organizationId: string): Promise<string[]> => {
    const rows = await db
      .select({ id: emailAccounts.id })
      .from(emailAccounts)
      .innerJoin(domains, eq(emailAccounts.domainId, domains.id))
      .where(eq(domains.organizationId, organizationId));
    return rows.map((r) => r.id);
  };

  app.get("/admin/health", async (req) => {
    const { organizationId } = orgQuery.parse(req.query ?? {});
    await requireOrgPermission(req.user!.id, organizationId, ["owner", "admin"]);
     const [dbOk, relay] = await Promise.all([pingDatabase(), Promise.resolve(getRelay().name)]);
    return {
      organizationId,
       ok: dbOk,
      db: dbOk ? "ok" : "down",
       mailEngine: { name: config.mailEngine, ok: dbOk, authentication: "better-auth-oidc" },
      outboundRelay: relay,
    };
  });

  app.get("/admin/stats", async (req) => {
    const { organizationId } = orgQuery.parse(req.query ?? {});
    await requireOrgPermission(req.user!.id, organizationId, ["owner", "admin"]);
    const accountIds = await orgAccountIds(organizationId);
    if (accountIds.length === 0) {
      return {
        organizationId,
        outboundQueue: 0,
        sending: 0,
        failed: 0,
        cancelled: 0,
        deferred: 0,
        byTransport: [],
        byDelivery: [],
        spamBlockedToday: 0,
        messagesToday: 0,
      };
    }

    const byTransport = await db
      .select({ transportStatus: outboundMessages.transportStatus, n: count() })
      .from(outboundMessages)
      .where(inArray(outboundMessages.accountId, accountIds))
      .groupBy(outboundMessages.transportStatus);
    const byDelivery = await db
      .select({ deliveryStatus: outboundMessages.deliveryStatus, n: count() })
      .from(outboundMessages)
      .where(inArray(outboundMessages.accountId, accountIds))
      .groupBy(outboundMessages.deliveryStatus);

    const [messagesToday, spamToday] = await Promise.all([
      db
        .select({ n: count() })
        .from(inboundMessages)
        .where(and(inArray(inboundMessages.accountId, accountIds), gte(inboundMessages.date, todayStart))),
      db
        .select({ n: count() })
        .from(inboundMessages)
        .where(
          and(
            inArray(inboundMessages.accountId, accountIds),
            gte(inboundMessages.date, todayStart),
            gte(inboundMessages.spamScore, sql`5`),
          ),
        ),
    ]);

    const outboundQueue = byTransport.find((s) => s.transportStatus === "queued")?.n ?? 0;
    const sending = byTransport.find((s) => s.transportStatus === "sending")?.n ?? 0;
    const failed = byTransport.find((s) => s.transportStatus === "failed")?.n ?? 0;
    const cancelled = byTransport.find((s) => s.transportStatus === "cancelled")?.n ?? 0;
    const deferred = byDelivery.find((s) => s.deliveryStatus === "deferred")?.n ?? 0;

    return {
      organizationId,
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
    const { organizationId } = orgQuery.parse(req.query ?? {});
    await requireOrgPermission(req.user!.id, organizationId, ["owner", "admin"]);
    const accountIds = await orgAccountIds(organizationId);
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
      .where(accountIds.length > 0 ? inArray(outboundMessages.accountId, accountIds) : sql`false`)
      .orderBy(desc(outboundMessages.createdAt))
      .limit(50);
    return { organizationId, outbound: rows };
  });

  app.get("/admin/audit", async (req) => {
    const input = z
      .object({
        organizationId: z.string().uuid(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      })
      .parse(req.query ?? {});
    const organizationId = input.organizationId;
    await requireOrgPermission(req.user!.id, organizationId, ["owner", "admin"]);
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
};
