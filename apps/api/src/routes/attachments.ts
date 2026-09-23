import type { FastifyInstance } from "fastify";
import { requireAccountPermission } from "../auth/authorize.js";
import { requireUser } from "../auth/middleware.js";
import { getUserEngine } from "../engine/index.js";
import { badRequest, notFound } from "../lib/errors.js";

interface Params {
  id: string;
  attachmentId: string;
}

interface Query {
  accountId?: string;
}

const safeFilename = (value: string): string => value
  .replace(/[\r\n]/g, " ")
  .replace(/["\\]/g, "_")
  .trim()
  .slice(0, 180) || "attachment";

export default async (app: FastifyInstance) => {
  await requireUser(app, { optional: false });

  app.get<{ Params: Params; Querystring: Query }>("/mail/messages/:id/attachments/:attachmentId", async (req, reply) => {
    const accountId = req.query.accountId;
    if (!accountId) throw badRequest("accountId is required");

    await requireAccountPermission(req.user!.id, accountId, "read");
    const engine = await getUserEngine({
      productUserId: req.user!.id,
      authUserId: req.authUserId ?? req.user!.id,
      accountId,
      headers: req.headers as Record<string, string>,
    });

    // Verify the requested blob actually belongs to this message before serving it.
    // Account-level authorization alone is not sufficient for an opaque attachment ID.
    const message = await engine.getMessage(accountId, req.params.id);
    if (!message) throw notFound("message not found");
    const attachment = message.attachments.find((item) => item.engineId === req.params.attachmentId);
    if (!attachment) throw notFound("attachment not found on message");

    const body = await engine.getAttachment(accountId, req.params.attachmentId);
    if (!body) throw notFound("attachment content not found");

    const filename = safeFilename(attachment.filename);
    reply.header("content-type", body.contentType || attachment.contentType || "application/octet-stream");
    reply.header("content-length", String(body.content.byteLength));
    reply.header("content-disposition", `attachment; filename="${filename}"`);
    reply.header("cache-control", "private, no-store");
    return reply.send(body.content);
  });
};

export { safeFilename };
