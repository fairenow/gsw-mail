import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAccountPermission } from "../auth/authorize.js";
import { requireUser } from "../auth/middleware.js";
import { getUserEngine } from "../engine/index.js";
import { describeJmapFailure } from "../lib/jmapError.js";
import { badRequest, notFound } from "../lib/errors.js";
import { submitSend } from "../outbound/sendFlow.js";
import { DEFAULT_MAIL_TEMPLATE_KEY } from "../mail/templates/index.js";
import { sanitizeRichText } from "../lib/richText.js";
import {
  appendDraftAttachments,
  clearDraftAttachments,
  listDraftAttachments,
  loadDraftAttachments,
  moveDraftAttachments,
  removeDraftAttachment,
  replaceDraftAttachments,
} from "../mail/draftAttachmentStore.js";

const attachmentSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1),
  size: z.number().int().nonnegative(),
  contentDisposition: z.enum(["attachment", "inline"]).optional(),
  contentId: z.string().optional(),
  content: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/, { message: "attachment content must be base64" }),
});

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
  mode: z.enum(["new", "reply", "replyAll", "forward"]).optional(),
  templateKey: z.string().optional(),
});

const sendDraftSchema = z.object({
  accountId: z.string().uuid(),
  clientRequestId: z.string().trim().min(1).max(200).optional(),
  mode: z.enum(["new", "reply", "replyAll", "forward"]).optional(),
  templateKey: z.string().optional(),
  attachments: z.array(attachmentSchema).max(20).optional(),
});

const draftAttachmentsSchema = z.object({
  accountId: z.string().uuid(),
  attachments: z.array(attachmentSchema).max(20),
});

export default async (app: FastifyInstance) => {
  await requireUser(app, { optional: false });

  app.post("/mail/drafts", async (req, reply) => {
    const input = draftSchema.parse(req.body);
    const account = await requireAccountPermission(req.user!.id, input.accountId, "send");
    const engine = await getUserEngine({
      productUserId: req.user!.id,
      authUserId: req.authUserId ?? req.user!.id,
      accountId: account.id,
      headers: req.headers as Record<string, string>,
      permission: "send",
    });
    const htmlBody = input.htmlBody ? sanitizeRichText(input.htmlBody) : undefined;

    try {
      const engineId = await engine.saveDraft(account.id, {
        from: account.address,
        to: input.to ?? [],
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        textBody: input.textBody,
        htmlBody,
        replyTo: input.replyTo,
        inReplyTo: input.inReplyTo,
        references: input.references,
      });
      reply.code(201);
      return { engineId };
    } catch (error) {
      req.log.error({ err: error, jmap: { method: "Email/set", operation: "create" }, ...draftLogContext(input, error) }, "draft creation failed");
      throw error;
    }
  });

  app.patch<{ Params: { id: string } }>("/mail/drafts/:id", async (req) => {
    const input = draftSchema.parse(req.body);
    const account = await requireAccountPermission(req.user!.id, input.accountId, "send");
    const engine = await getUserEngine({
      productUserId: req.user!.id,
      authUserId: req.authUserId ?? req.user!.id,
      accountId: account.id,
      headers: req.headers as Record<string, string>,
      permission: "send",
    });
    const htmlBody = input.htmlBody ? sanitizeRichText(input.htmlBody) : undefined;

    try {
      const engineId = await engine.updateDraft(account.id, req.params.id, {
        from: account.address,
        to: input.to ?? [],
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        textBody: input.textBody,
        htmlBody,
        replyTo: input.replyTo,
        inReplyTo: input.inReplyTo,
        references: input.references,
      });
      await moveDraftAttachments(account.id, req.params.id, engineId);
      return { engineId };
    } catch (error) {
      req.log.error({ err: error, jmap: { method: "Email/set", operation: "replace" }, draftId: req.params.id, ...draftLogContext(input, error) }, "draft update failed");
      throw error;
    }
  });

  app.get<{ Params: { id: string }; Querystring: { accountId?: string } }>("/mail/drafts/:id/attachments", async (req) => {
    const accountId = req.query.accountId;
    if (!accountId) throw badRequest("accountId is required");
    await requireAccountPermission(req.user!.id, accountId, "read");
    return { attachments: await listDraftAttachments(accountId, req.params.id) };
  });

  app.put<{ Params: { id: string } }>("/mail/drafts/:id/attachments", async (req) => {
    const input = draftAttachmentsSchema.parse(req.body);
    await requireAccountPermission(req.user!.id, input.accountId, "send");
    await replaceDraftAttachments(input.accountId, req.params.id, input.attachments);
    return { attachments: await listDraftAttachments(input.accountId, req.params.id) };
  });

  app.post<{ Params: { id: string } }>("/mail/drafts/:id/attachments", async (req) => {
    const input = draftAttachmentsSchema.parse(req.body);
    await requireAccountPermission(req.user!.id, input.accountId, "send");
    const existing = await listDraftAttachments(input.accountId, req.params.id);
    if (existing.length + input.attachments.length > 20) throw badRequest("too many draft attachments (max 20)");
    await appendDraftAttachments(input.accountId, req.params.id, input.attachments);
    return { attachments: await listDraftAttachments(input.accountId, req.params.id) };
  });

  app.delete<{ Params: { id: string; position: string }; Querystring: { accountId?: string } }>("/mail/drafts/:id/attachments/:position", async (req) => {
    const accountId = req.query.accountId;
    if (!accountId) throw badRequest("accountId is required");
    await requireAccountPermission(req.user!.id, accountId, "send");
    const position = Number(req.params.position);
    if (!Number.isInteger(position) || position < 0) throw badRequest("attachment position must be a non-negative integer");
    await removeDraftAttachment(accountId, req.params.id, position);
    return { attachments: await listDraftAttachments(accountId, req.params.id) };
  });

  app.post<{ Params: { id: string } }>("/mail/drafts/:id/send", async (req, reply) => {
    const body = sendDraftSchema.parse(req.body);
    const account = await requireAccountPermission(req.user!.id, body.accountId, "send");
    const engine = await getUserEngine({
      productUserId: req.user!.id,
      authUserId: req.authUserId ?? req.user!.id,
      accountId: account.id,
      headers: req.headers as Record<string, string>,
      permission: "send",
    });
    const draft = await engine.getMessage(body.accountId, req.params.id);
    if (!draft) throw notFound("draft not found");

    const htmlBody = draft.htmlBody ? sanitizeRichText(draft.htmlBody) : undefined;
    const attachments = body.attachments ?? await loadDraftAttachments(body.accountId, req.params.id);

    req.log.info({
      draftId: req.params.id,
      hasHtmlBody: Boolean(draft.htmlBody),
      hasTextBody: Boolean(draft.textBody),
      htmlLength: draft.htmlBody?.length ?? 0,
      textLength: draft.textBody?.length ?? 0,
      htmlHasSignatureMarker: draft.htmlBody?.includes("gsw-signature") ?? false,
      htmlPreview: draft.htmlBody?.slice(0, 500),
      textPreview: draft.textBody?.slice(0, 250),
      attachmentCount: attachments.length,
      persistedAttachmentCount: body.attachments ? 0 : attachments.length,
    }, "draft body before submitSend");

    let result: Awaited<ReturnType<typeof submitSend>>;
    try {
      result = await submitSend({
        userId: req.user!.id,
        accessToken: req.accessToken,
        authUserId: req.authUserId,
        headers: req.headers as Record<string, string>,
        account,
        to: draft.to.map((a) => a.email),
        cc: draft.cc.map((a) => a.email),
        subject: draft.subject,
        textBody: draft.textBody,
        htmlBody,
        templateKey: body.templateKey ?? DEFAULT_MAIL_TEMPLATE_KEY,
        mode: body.mode,
        replyTo: draft.headers["Reply-To"],
        inReplyTo: draft.headers["In-Reply-To"],
        references: draft.headers["References"],
        attachments,
        clientRequestId: body.clientRequestId,
      });
    } catch (error) {
      req.log.error({
        err: error,
        jmap: { method: "Email/set", operation: "sent" },
        accountId: body.accountId,
        replyMode: body.mode ?? (draft.headers["In-Reply-To"] ? "reply" : "new"),
        recipients: { to: draft.to.map((a) => a.email), cc: draft.cc.map((a) => a.email), bccCount: draft.headers.Bcc ? 1 : 0 },
        subject: draft.subject,
        threading: { hasInReplyTo: Boolean(draft.headers["In-Reply-To"]), hasReferences: Boolean(draft.headers.References) },
        attachmentCount: attachments.length,
        jmapFailure: describeJmapFailure(error),
      }, "draft send failed");
      throw error;
    }

    try {
      await engine.move(body.accountId, [req.params.id], "Trash");
      await clearDraftAttachments(body.accountId, req.params.id);
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

function draftLogContext(
  input: {
    accountId: string;
    to?: string[] | undefined;
    cc?: string[] | undefined;
    subject?: string | undefined;
    inReplyTo?: string | undefined;
    references?: string | undefined;
    mode?: string | undefined;
  },
  error: unknown,
) {
  return {
    accountId: input.accountId,
    mode: input.mode ?? (input.inReplyTo ? "reply" : "new"),
    recipientCount: (input.to?.length ?? 0) + (input.cc?.length ?? 0),
    subjectPresent: Boolean(input.subject),
    threading: { hasInReplyTo: Boolean(input.inReplyTo), hasReferences: Boolean(input.references) },
    jmapFailure: describeJmapFailure(error),
  };
}
