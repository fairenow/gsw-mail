import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAccountPermission } from "../auth/authorize.js";
import { requireUser } from "../auth/middleware.js";
import { getEngine } from "../engine/index.js";
import { notFound } from "../lib/errors.js";
import { submitSend } from "../outbound/sendFlow.js";

const draftSchema = z.object({
  accountId: z.string().uuid(),
  to: z.array(z.string().email()).optional(),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  subject: z.string().max(998).optional(),
  textBody: z.string().optional(),
  htmlBody: z.string().optional(),
  replyTo: z.string().email().optional(),
  inReplyTo: z.string().optional(),
  references: z.string().optional(),
});

const sendDraftSchema = z.object({
  accountId: z.string().uuid(),
  clientRequestId: z.string().trim().min(1).max(200).optional(),
  mode: z.enum(["new", "reply", "replyAll", "forward"]).optional(),
});

export default async (app: FastifyInstance) => {
  await requireUser(app, { optional: false });

  app.post("/mail/drafts", async (req, reply) => {
    const input = draftSchema.parse(req.body);
    const account = await requireAccountPermission(req.user!.id, input.accountId, "send");
    const engine = getEngine(req.accessToken);
    const engineId = await engine.saveDraft(account.id, {
      from: account.address,
      to: input.to ?? [],
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      textBody: input.textBody,
      htmlBody: input.htmlBody,
      replyTo: input.replyTo,
      inReplyTo: input.inReplyTo,
      references: input.references,
    });
    reply.code(201);
    return { engineId };
  });

  app.patch<{ Params: { id: string } }>("/mail/drafts/:id", async (req, reply) => {
    const input = draftSchema.parse(req.body);
    const account = await requireAccountPermission(req.user!.id, input.accountId, "send");
    const engine = getEngine(req.accessToken);
    await engine.updateDraft(account.id, req.params.id, {
      from: account.address,
      to: input.to ?? [],
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      textBody: input.textBody,
      htmlBody: input.htmlBody,
      replyTo: input.replyTo,
      inReplyTo: input.inReplyTo,
      references: input.references,
    });
    reply.code(204);
    return;
  });

  app.post<{ Params: { id: string } }>("/mail/drafts/:id/send", async (req, reply) => {
    const body = sendDraftSchema.parse(req.body);
    const account = await requireAccountPermission(req.user!.id, body.accountId, "send");
    const engine = getEngine(req.accessToken);

    const draft = await engine.getMessage(body.accountId, req.params.id);
    if (!draft) throw notFound("draft not found");

    let result: Awaited<ReturnType<typeof submitSend>>;
    try {
      result = await submitSend({
        userId: req.user!.id,
        accessToken: req.accessToken,
        account,
        to: draft.to.map((a) => a.email),
        cc: draft.cc.map((a) => a.email),
        subject: draft.subject,
        textBody: draft.textBody,
        htmlBody: draft.htmlBody,
        replyTo: draft.headers["Reply-To"],
        inReplyTo: draft.headers["In-Reply-To"],
        references: draft.headers["References"],
        clientRequestId: body.clientRequestId,
      });
    } catch (error) {
      req.log.error({
        err: error,
        accountId: body.accountId,
        replyMode: body.mode ?? (draft.headers["In-Reply-To"] ? "reply" : "new"),
        recipients: { to: draft.to.map((a) => a.email), cc: draft.cc.map((a) => a.email), bccCount: draft.headers.Bcc ? 1 : 0 },
        subject: draft.subject,
        threading: { hasInReplyTo: Boolean(draft.headers["In-Reply-To"]), hasReferences: Boolean(draft.headers.References) },
      }, "draft send failed");
      throw error;
    }
    try {
      await engine.move(body.accountId, [req.params.id], "Trash");
    } catch {
      app.log.warn({ draftId: req.params.id }, "draft cleanup failed after send");
    }
    reply.code(202);
    return {
      sendId: result.sendId,
      messageId: result.messageId,
      threadId: result.threadId,
      status: result.transportStatus,
      undoUntil: result.undoUntil,
    };
  });
};
