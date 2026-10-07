import { requireAccountPermission } from "../auth/authorize.js";
import { getUserEngine } from "../engine/index.js";
import { notFound } from "../lib/errors.js";
import { hasRemoteMailImages, sanitizeInboundMailHtml, sanitizeRichText } from "../lib/richText.js";

export interface MailServiceContext {
  userId: string;
  authUserId: string;
  headers: Record<string, string>;
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
  };
}
