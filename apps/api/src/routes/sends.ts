import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { z } from "zod";
import { requireAccountPermission } from "../auth/authorize.js";
import { requireUser } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { outboundMessages } from "../db/schema.js";
import { getEngine } from "../engine/index.js";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { cancelSend, getSendStatus, retrySend } from "../outbound/queue.js";

interface Params {
  id: string;
}

export default fp(async (app: FastifyInstance) => {
  app.register(requireUser, { optional: false });

  app.get<{ Params: Params }>("/mail/sends/:id", async (req) => {
    const [row] = await db
      .select({ accountId: outboundMessages.accountId })
      .from(outboundMessages)
      .where(eq(outboundMessages.id, req.params.id))
      .limit(1);
    if (!row) throw notFound("send not found");
    await requireAccountPermission(req.user!.id, row.accountId, "read");
    const status = await getSendStatus(req.params.id);
    if (!status) throw notFound("send not found");
    return status;
  });

  app.post<{ Params: Params }>("/mail/sends/:id/cancel", async (req) => {
    const [row] = await db
      .select({ accountId: outboundMessages.accountId, engineMessageId: outboundMessages.engineMessageId })
      .from(outboundMessages)
      .where(eq(outboundMessages.id, req.params.id))
      .limit(1);
    if (!row) throw notFound("send not found");
    await requireAccountPermission(req.user!.id, row.accountId, "send");

    const cancelled = await cancelSend(req.params.id);
    if (!cancelled) throw badRequest("send can only be cancelled while preparing or queued");

    if (row.engineMessageId) {
      await getEngine().move(row.accountId, [row.engineMessageId], "Drafts");
    }
    await audit({
      actorUserId: req.user!.id,
      action: "message.undo",
      resourceType: "outbound_message",
      resourceId: req.params.id,
      request: req,
    });
    return { sendId: req.params.id, status: "cancelled" };
  });

  app.post<{ Params: Params; Body: { accountId?: string } }>("/mail/sends/:id/retry", async (req, reply) => {
    const body = z.object({ accountId: z.string().uuid() }).parse(req.body ?? {});
    const [row] = await db
      .select({ accountId: outboundMessages.accountId })
      .from(outboundMessages)
      .where(eq(outboundMessages.id, req.params.id))
      .limit(1);
    if (!row) throw notFound("send not found");
    if (row.accountId !== body.accountId) throw badRequest("accountId does not match this send");
    await requireAccountPermission(req.user!.id, row.accountId, "send");

    const retried = await retrySend(req.params.id);
    if (!retried) throw badRequest("only failed sends can be retried");
    await audit({
      actorUserId: req.user!.id,
      action: "message.retry_requested",
      resourceType: "outbound_message",
      resourceId: req.params.id,
      request: req,
    });
    reply.code(202);
    return { sendId: req.params.id, status: "queued" };
  });
});