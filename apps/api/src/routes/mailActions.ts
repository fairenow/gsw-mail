import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAccountPermission } from "../auth/authorize.js";
import { requireUser } from "../auth/middleware.js";
import { getUserEngine } from "../engine/index.js";
import { badRequest, notFound } from "../lib/errors.js";

const bulkSchema = z.object({
  accountId: z.string().uuid(),
  ids: z.array(z.string().min(1)).min(1).max(100),
  action: z.enum(["archive", "trash", "restore", "destroy", "read", "unread", "star", "unstar"]),
});

type AttachmentParams = { id: string };
type AttachmentQuery = { accountId?: string; filename?: string };

const safeFilename = (value: string): string => value.replace(/[\r\n"\\/]/g, "_").slice(0, 255) || "attachment";

export default async (app: FastifyInstance) => {
  await requireUser(app, { optional: false });

  app.post("/mail/messages/bulk", async (req) => {
    const input = bulkSchema.parse(req.body);
    const permission = input.action === "read" || input.action === "unread" || input.action === "star" || input.action === "unstar" ? "read" : "send";
    await requireAccountPermission(req.user!.id, input.accountId, permission);
    const engine = await getUserEngine({
      productUserId: req.user!.id,
      authUserId: req.authUserId ?? req.user!.id,
      accountId: input.accountId,
      headers: req.headers as Record<string, string>,
      ...(permission === "send" ? { permission: "send" as const } : {}),
    });

    if (input.action === "archive") await engine.move(input.accountId, input.ids, "Archive");
    else if (input.action === "trash") await engine.move(input.accountId, input.ids, "Trash");
    else if (input.action === "restore") await engine.move(input.accountId, input.ids, "Inbox");
    else if (input.action === "destroy") await engine.destroy(input.accountId, input.ids);
    else if (input.action === "read") await engine.setSeen(input.accountId, input.ids, true);
    else if (input.action === "unread") await engine.setSeen(input.accountId, input.ids, false);
    else if (input.action === "star") await engine.setFlagged(input.accountId, input.ids, true);
    else if (input.action === "unstar") await engine.setFlagged(input.accountId, input.ids, false);

    return { updated: input.ids.length, action: input.action };
  });

  app.get<{ Params: AttachmentParams; Querystring: AttachmentQuery }>("/mail/attachments/:id", async (req, reply) => {
    const accountId = req.query.accountId;
    if (!accountId) throw badRequest("accountId is required");
    await requireAccountPermission(req.user!.id, accountId, "read");
    const engine = await getUserEngine({
      productUserId: req.user!.id,
      authUserId: req.authUserId ?? req.user!.id,
      accountId,
      headers: req.headers as Record<string, string>,
    });
    const attachment = await engine.getAttachment(accountId, req.params.id);
    if (!attachment) throw notFound("attachment not found");
    const filename = safeFilename(req.query.filename ?? "attachment");
    reply.header("Content-Type", attachment.contentType || "application/octet-stream");
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    reply.header("Content-Length", String(attachment.content.length));
    reply.header("Cache-Control", "private, max-age=300");
    return reply.send(attachment.content);
  });
};
