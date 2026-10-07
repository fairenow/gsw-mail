import { requireAccountPermission } from "../auth/authorize.js";
import { getUserEngine } from "../engine/index.js";
import { notFound } from "../lib/errors.js";
import { submitSend } from "../outbound/sendFlow.js";
import { DEFAULT_MAIL_TEMPLATE_KEY } from "../mail/templates/index.js";
import { clearDraftAttachments, loadDraftAttachments, moveDraftAttachments } from "../mail/draftAttachmentStore.js";
import { hasRemoteMailImages, sanitizeInboundMailHtml, sanitizeRichText } from "../lib/richText.js";

export interface MailServiceContext {
  userId: string;
  authUserId: string;
  headers: Record<string, string>;
  accessToken?: string | undefined;
}

export function createMailService(context: MailServiceContext) {
  const engineFor = async (accountId: string, permission?: "read" | "send" | "manage") => {
    if (permission) await requireAccountPermission(context.userId, accountId, permission);
    return getUserEngine({
      productUserId: context.userId,
      authUserId: context.authUserId,
      accountId,
      headers: context.headers,
      ...(permission === "send" || permission === "manage" ? { permission } : {}),
    });
  };

  return {
    async search(accountId: string, query: string, mailbox?: string) {
      await requireAccountPermission(context.userId, accountId, "read");
      const engine = await engineFor(accountId);
      return engine.search(accountId, query, mailbox);
    },

    async readThread(accountId: string, threadId: string) {
      await requireAccountPermission(context.userId, accountId, "read");
      const engine = await engineFor(accountId);
      const messages = await engine.getThread(accountId, threadId);
      if (messages.length === 0) throw notFound("thread not found");
      return messages;
    },

    async readMessage(accountId: string, messageId: string, allowRemoteImages: boolean) {
      const engine = await engineFor(accountId);
      const message = await engine.getMessage(accountId, messageId);
      if (!message) throw notFound("message not found");
      const rawHtmlBody = message.htmlBody;
      const hasRemoteImages = rawHtmlBody ? hasRemoteMailImages(rawHtmlBody) : false;
      return {
        ...message,
        ...(rawHtmlBody
          ? {
              htmlBody: allowRemoteImages ? sanitizeRichText(rawHtmlBody) : sanitizeInboundMailHtml(rawHtmlBody),
              remoteImagesBlocked: hasRemoteImages && !allowRemoteImages,
            }
          : {}),
      };
    },

    async setSeen(accountId: string, messageId: string, seen: boolean) {
      const engine = await engineFor(accountId);
      await engine.setSeen(accountId, [messageId], seen);
    },

    async archive(accountId: string, messageId: string) {
      const engine = await engineFor(accountId, "send");
      await engine.move(accountId, [messageId], "Archive");
    },

    async createDraft(accountId: string, input: {
      to: string[];
      cc?: string[] | undefined;
      bcc?: string[] | undefined;
      subject?: string | undefined;
      textBody?: string | undefined;
      htmlBody?: string | undefined;
      replyTo?: string | undefined;
      inReplyTo?: string | undefined;
      references?: string | undefined;
    }) {
      const account = await requireAccountPermission(context.userId, accountId, "send");
      const engine = await engineFor(accountId, "send");
      const engineId = await engine.saveDraft(accountId, {
        from: account.address,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        textBody: input.textBody,
        htmlBody: input.htmlBody ? sanitizeRichText(input.htmlBody) : undefined,
        replyTo: input.replyTo,
        inReplyTo: input.inReplyTo,
        references: input.references,
      });
      return { engineId };
    },

    async updateDraft(accountId: string, draftId: string, input: {
      to: string[];
      cc?: string[] | undefined;
      bcc?: string[] | undefined;
      subject?: string | undefined;
      textBody?: string | undefined;
      htmlBody?: string | undefined;
      replyTo?: string | undefined;
      inReplyTo?: string | undefined;
      references?: string | undefined;
    }) {
      const account = await requireAccountPermission(context.userId, accountId, "send");
      const engine = await engineFor(accountId, "send");
      const engineId = await engine.updateDraft(accountId, draftId, {
        from: account.address,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        textBody: input.textBody,
        htmlBody: input.htmlBody ? sanitizeRichText(input.htmlBody) : undefined,
        replyTo: input.replyTo,
        inReplyTo: input.inReplyTo,
        references: input.references,
      });
      await moveDraftAttachments(accountId, draftId, engineId);
      return { engineId };
    },

    async sendDraft(accountId: string, draftId: string, clientRequestId?: string | undefined) {
      const account = await requireAccountPermission(context.userId, accountId, "send");
      const engine = await engineFor(accountId, "send");
      const draft = await engine.getMessage(accountId, draftId);
      if (!draft) throw notFound("draft not found");
      const attachments = await loadDraftAttachments(accountId, draftId);
      const htmlBody = draft.htmlBody ? sanitizeRichText(draft.htmlBody) : undefined;
      const result = await submitSend({
        userId: context.userId,
        accessToken: context.accessToken,
        authUserId: context.authUserId,
        headers: context.headers,
        account,
        to: draft.to.map((address) => address.email),
        cc: draft.cc.map((address) => address.email),
        subject: draft.subject,
        textBody: draft.textBody,
        htmlBody,
        templateKey: DEFAULT_MAIL_TEMPLATE_KEY,
        replyTo: draft.headers["Reply-To"],
        inReplyTo: draft.headers["In-Reply-To"],
        references: draft.headers["References"],
        attachments,
        clientRequestId,
      });

      try {
        await engine.move(accountId, [draftId], "Trash");
        await clearDraftAttachments(accountId, draftId);
      } catch {
        // Sending succeeded; cleanup is best-effort and mirrors the HTTP draft-send route.
      }

      return {
        sendId: result.sendId,
        messageId: result.messageId,
        threadId: result.threadId,
        status: result.transportStatus,
        undoUntil: result.undoUntil,
        idempotentReplay: result.idempotentReplay === true,
      };
    },
  };
}
