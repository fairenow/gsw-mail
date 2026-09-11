import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { requireAdmin, requireUser } from "../auth/middleware.js";
import { db, pingDatabase } from "../db/client.js";
import { inboundMessages, outboundMessages } from "../db/schema.js";
import { getEngine } from "../engine/index.js";
import { getRelay } from "../outbound/relay.js";

const todayStart = sql`date_trunc('day', now())`;
const admin = { preHandler: requireAdmin };

export default fp(async (app: FastifyInstance) => {
  app.register(requireUser, { optional: false });

  app.get("/admin/health", admin, async () => {
    const [dbOk, engine, relay] = await Promise.all([pingDatabase(), getEngine().status(), Promise.resolve(getRelay().name)]);
    return {
      ok: dbOk && engine.ok,
      db: dbOk ? "ok" : "down",
      mailEngine: engine,
      outboundRelay: relay,
    };
  });

  app.get("/admin/stats", admin, async () => {
    const statuses = await db
      .select({ status: outboundMessages.status, n: count() })
      .from(outboundMessages)
      .groupBy(outboundMessages.status);

    const [messagesToday, spamToday] = await Promise.all([
      db.select({ n: count() }).from(inboundMessages).where(gte(inboundMessages.date, todayStart)),
      db
        .select({ n: count() })
        .from(inboundMessages)
        .where(and(gte(inboundMessages.date, todayStart), gte(inboundMessages.spamScore, sql`5`))),
    ]);

    return {
      outboundQueue: statuses.find((s) => s.status === "queued")?.n ?? 0,
      sending: statuses.find((s) => s.status === "sending")?.n ?? 0,
      deferred: statuses.find((s) => s.status === "deferred")?.n ?? 0,
      failed: statuses.find((s) => s.status === "failed")?.n ?? 0,
      byStatus: statuses,
      spamBlockedToday: spamToday[0]?.n ?? 0,
      messagesToday: messagesToday[0]?.n ?? 0,
    };
  });

  app.get("/admin/outbound", admin, async () => {
    const rows = await db
      .select({
        id: outboundMessages.id,
        fromAddress: outboundMessages.fromAddress,
        to: outboundMessages.to,
        subject: outboundMessages.subject,
        status: outboundMessages.status,
        attempts: outboundMessages.attempts,
        nextAttemptAt: outboundMessages.nextAttemptAt,
        lastError: outboundMessages.lastError,
        createdAt: outboundMessages.createdAt,
      })
      .from(outboundMessages)
      .orderBy(desc(outboundMessages.createdAt))
      .limit(50);
    return { outbound: rows };
  });
});