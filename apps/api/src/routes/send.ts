import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { z } from "zod";
import { requireAccountPermission } from "../auth/authorize.js";
import { requireUser } from "../auth/middleware.js";
import { submitSend } from "../outbound/sendFlow.js";

const sendSchema = z.object({
  accountId: z.string().uuid(),
  to: z.array(z.string().email({ message: "invalid recipient" })).min(1),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  subject: z.string().max(998, { message: "subject too long" }).optional(),
  textBody: z.string().optional(),
  htmlBody: z.string().optional(),
  replyTo: z.string().email().optional(),
  inReplyTo: z.string().optional(),
  references: z.string().optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string().min(1).max(255),
        contentType: z.string().min(1),
        size: z.number().int().nonnegative(),
        contentDisposition: z.enum(["attachment", "inline"]).optional(),
        contentId: z.string().optional(),
      }),
    )
    .max(20)
    .optional(),
  clientRequestId: z.string().trim().min(1).max(200).optional(),
});

export default fp(async (app: FastifyInstance) => {
  app.register(requireUser, { optional: false });

  app.post("/mail/send", async (req, reply) => {
    const input = sendSchema.parse(req.body);
    const account = await requireAccountPermission(req.user!.id, input.accountId, "send");
    const result = await submitSend({
      userId: req.user!.id,
      account,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      textBody: input.textBody,
      htmlBody: input.htmlBody,
      replyTo: input.replyTo,
      inReplyTo: input.inReplyTo,
      references: input.references,
      attachments: input.attachments,
      clientRequestId: input.clientRequestId,
    });
    reply.code(202);
    return {
      sendId: result.sendId,
      messageId: result.messageId,
      threadId: result.threadId,
      status: result.transportStatus,
      undoUntil: result.undoUntil,
      ...(result.idempotentReplay ? { idempotentReplay: true } : {}),
    };
  });
});