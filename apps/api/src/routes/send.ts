import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAccountPermission } from "../auth/authorize.js";
import { requireUser } from "../auth/middleware.js";
import { submitSend } from "../outbound/sendFlow.js";
import { describeJmapFailure } from "../lib/jmapError.js";

const sendSchema = z.object({
  accountId: z.string().uuid(),
  to: z.array(z.string().email({ message: "invalid recipient" })).min(1),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  subject: z.string().max(998, { message: "subject too long" }).optional(),
  textBody: z.string().optional(),
  htmlBody: z.string().optional(),
  templateKey: z.string().optional(),
  replyTo: z.string().email().optional(),
  inReplyTo: z.string().optional(),
  references: z.string().optional(),
  mode: z.enum(["new", "reply", "replyAll", "forward"]).optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string().min(1).max(255),
        contentType: z.string().min(1),
        size: z.number().int().nonnegative(),
        contentDisposition: z.enum(["attachment", "inline"]).optional(),
        contentId: z.string().optional(),
        content: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/, { message: "attachment content must be base64" }).optional(),
      }),
    )
    .max(20)
    .optional(),
  clientRequestId: z.string().trim().min(1).max(200).optional(),
});

export default async (app: FastifyInstance) => {
  await requireUser(app, { optional: false });

  app.post("/mail/send", async (req, reply) => {
    const input = sendSchema.parse(req.body);
    const account = await requireAccountPermission(req.user!.id, input.accountId, "send");
    try {
      const result = await submitSend({
        userId: req.user!.id,
        accessToken: req.accessToken,
        authUserId: req.authUserId,
        headers: req.headers as Record<string, string>,
        account,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        textBody: input.textBody,
         htmlBody: input.htmlBody,
         templateKey: input.templateKey,
         mode: input.mode,
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
    } catch (error) {
      req.log.error({
        err: error,
        jmap: { method: "Email/set", operation: "sent" },
        accountId: input.accountId,
        replyMode: input.mode ?? (input.inReplyTo ? "reply" : "new"),
        recipients: { to: input.to, cc: input.cc ?? [], bccCount: input.bcc?.length ?? 0 },
        subject: input.subject ?? "",
        threading: { hasInReplyTo: Boolean(input.inReplyTo), hasReferences: Boolean(input.references) },
        jmapFailure: describeJmapFailure(error),
      }, "mail send failed");
      throw error;
    }
  });
};
