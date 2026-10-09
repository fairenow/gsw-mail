import { eq } from "drizzle-orm";
import { requireAccountPermission } from "../auth/authorize.js";
import { getUserEngine } from "../engine/index.js";
import { db } from "../db/client.js";
import { emailSignatures, userSettings } from "../db/schema.js";
import { notFound } from "../lib/errors.js";
import { submitSend } from "../outbound/sendFlow.js";
import { DEFAULT_MAIL_TEMPLATE_KEY, resolveMailTemplateKey } from "../mail/templates/index.js";
import { getCustomEmailTemplate, isCustomTemplateKey } from "../mail/templateService.js";
import { templateKeyAllowedForAddress } from "../lib/templatePolicy.js";
import { clearDraftAttachments, loadDraftAttachments, moveDraftAttachments } from "../mail/draftAttachmentStore.js";
import { hasRemoteMailImages, richTextToPlainText, sanitizeInboundMailHtml, sanitizeRichText } from "../lib/richText.js";

export interface MailServiceContext {
  userId: string;
  authUserId: string;
  headers: Record<string, string>;
  accessToken?: string | undefined;
}

type DraftMode = "new" | "reply" | "replyAll" | "forward";

const escapeHtml = (value: string): string => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const textToRichHtml = (value: string): string => value
  .trim()
  .split(/\n\s*\n/)
  .filter(Boolean)
  .map((paragraph) => `<p>${escapeHtml(paragraph.trim()).replaceAll("\n", "<br>")}</p>`)
  .join("");

async function resolveComposePreferences(userId: string, address: string, mode: DraftMode) {
  const [[settings], [signature]] = await Promise.all([
    db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1),
    db.select().from(emailSignatures).where(eq(emailSignatures.userId, userId)).limit(1),
  ]);

  const savedTemplateKey = typeof settings?.general?.templateKey === "string"
    ? settings.general.templateKey
    : DEFAULT_MAIL_TEMPLATE_KEY;
  let templateKey: string;
  if (isCustomTemplateKey(savedTemplateKey)) {
    try {
      await getCustomEmailTemplate(userId, savedTemplateKey);
      templateKey = savedTemplateKey;
    } catch {
      templateKey = "none";
    }
  } else {
    const resolvedTemplateKey = resolveMailTemplateKey(savedTemplateKey);
    templateKey = templateKeyAllowedForAddress(resolvedTemplateKey, address) ? resolvedTemplateKey : "none";
  }
  const richText = settings?.compose?.defaultFormat !== "plain";
  const signatureEnabled = Boolean(signature?.enabled)
    && (mode === "new"
      ? Boolean(signature?.onNew)
      : mode === "forward"
        ? Boolean(signature?.onForward)
        : Boolean(signature?.onReply));

  return {
    templateKey,
    richText,
    signature: signatureEnabled ? (signature ?? null) : null,
  };
}

const normalizeSignatureText = (value: string): string => value
  .replace(/\u00a0/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

const alreadyContainsConfiguredSignature = (bodyText: string, signatureText: string): boolean => {
  const body = normalizeSignatureText(bodyText);
  const signature = normalizeSignatureText(signatureText);
  return Boolean(body && signature && (body === signature || body.endsWith(` ${signature}`) || body.endsWith(signature)));
};

export function applySignature(input: {
  textBody?: string | undefined;
  htmlBody?: string | undefined;
  richText: boolean;
  signature: typeof emailSignatures.$inferSelect | null;
}) {
  const rawText = input.textBody?.trim() ?? "";
  const rawHtml = input.htmlBody?.trim() ?? "";
  const signatureText = input.signature?.signatureText?.trim() ?? "";
  const signatureHtml = input.signature?.signatureHtml?.trim() ?? "";

  const htmlPlainText = rawHtml ? richTextToPlainText(rawHtml) : "";
  const textHasSignature = alreadyContainsConfiguredSignature(rawText, signatureText);
  const htmlHasSignature = rawHtml.includes('class="gsw-signature"')
    || alreadyContainsConfiguredSignature(htmlPlainText, signatureText);

  const textBody = [rawText, !textHasSignature ? signatureText : ""].filter(Boolean).join("\n\n") || undefined;
  const baseHtml = rawHtml || (input.richText && rawText ? textToRichHtml(rawText) : "");
  const htmlBody = [
    baseHtml,
    signatureHtml && !htmlHasSignature && !(!rawHtml && textHasSignature)
      ? `<div class="gsw-signature">${sanitizeRichText(signatureHtml)}</div>`
      : "",
  ]
    .filter(Boolean)
    .join("<br>")
    || undefined;

  return { textBody, htmlBody };
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

    async activity(accountId: string, startIso: string, endIso: string, requestedMailboxes?: string[]) {
      const account = await requireAccountPermission(context.userId, accountId, "read");
      const mailboxAddress = account.address.toLowerCase();
      const engine = await engineFor(accountId);
      const start = new Date(startIso);
      const end = new Date(endIso);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
        throw new Error("mail activity requires a valid start/end time range");
      }

      const available = await engine.listMailboxes(accountId);
      const defaults = ["inbox", "sent", "drafts", "outbox", "trash"];
      const explicitMailboxes = Boolean(requestedMailboxes?.length);
      const requested = (requestedMailboxes?.length ? requestedMailboxes : defaults).map((value) => value.trim().toLowerCase());
      const targets = available.filter((mailbox) => {
        const role = mailbox.role?.toLowerCase() ?? "";
        const name = mailbox.engineName.toLowerCase();
        return requested.includes(role) || requested.includes(name);
      });

      const folders = [];
      for (const mailbox of targets) {
        const folderRole = (mailbox.role || mailbox.engineName).toLowerCase();
        // Page across the folder before applying the date filter. A single
        // 250-message page could silently undercount busy outreach mailboxes.
        const pageSize = 250;
        const maxPages = 20;
        const inRange = [];
        let exhausted = false;
        for (let page = 0; page < maxPages; page += 1) {
          const messages = await engine.listMessages(accountId, {
            mailbox: mailbox.engineName, limit: pageSize, offset: page * pageSize,
          });
          inRange.push(...messages.filter((message) => message.date >= start && message.date < end));
          if (messages.length < pageSize) { exhausted = true; break; }
        }
        inRange.sort((a, b) => a.date.getTime() - b.date.getTime());
        folders.push({
          mailbox: mailbox.engineName,
          role: mailbox.role,
          count: inRange.length,
          complete: exhausted,
          messages: inRange.map((message) => ({
            messageId: message.engineId,
            threadId: message.threadId,
            subject: message.subject,
            date: message.date,
            from: message.from,
            to: message.to,
            cc: message.cc,
            snippet: message.snippet,
            read: message.read,
            hasAttachments: message.hasAttachments,
            // Direction is based on sender versus selected mailbox, not folder alone.
            // A self-sent Inbox copy could be BCC, forwarding, or another delivery.
            direction: folderRole === "sent" ? "outbound" : folderRole === "drafts" || folderRole === "draft" ? "draft" : folderRole === "outbox" ? "queued" : folderRole === "trash" ? "deleted_folder" : JSON.stringify(message.from ?? "").toLowerCase().includes(mailboxAddress) ? "outbound_copy" : "inbound",
          })),
        });
      }

      const missing = requested.filter((needle) => !targets.some((mailbox) => mailbox.role?.toLowerCase() === needle || mailbox.engineName.toLowerCase() === needle));
      const missingOptionalMailboxes = explicitMailboxes ? [] : missing.filter((name) => name === "outbox");
      const missingRequiredMailboxes = missing.filter((name) => !missingOptionalMailboxes.includes(name));

      const directionCounts = {
        inbound: 0, outbound: 0, outboundCopy: 0, draft: 0, queued: 0, deletedFolder: 0,
      };
      for (const folder of folders) {
        for (const message of folder.messages) {
          if (message.direction === "inbound") directionCounts.inbound += 1;
          else if (message.direction === "outbound") directionCounts.outbound += 1;
          else if (message.direction === "outbound_copy") directionCounts.outboundCopy += 1;
          else if (message.direction === "draft") directionCounts.draft += 1;
          else if (message.direction === "queued") directionCounts.queued += 1;
          else if (message.direction === "deleted_folder") directionCounts.deletedFolder += 1;
        }
      }

      return {
        start: start.toISOString(),
        end: end.toISOString(),
        total: folders.reduce((sum, folder) => sum + folder.count, 0),
        complete: folders.every((folder) => folder.complete) && missingRequiredMailboxes.length === 0,
        folderCountsAreDistinctFromMessageDirection: true,
        directionCounts,
        directionCountsMayIncludeDuplicateCopies: true,
        // This endpoint does not establish that Inbox copies were BCC, nor can
        // it prove actual outbound delivery without transport/provider evidence.
        outboundDeliveryVerified: false,
        folders,
        missingRequestedMailboxes: missing,
        missingOptionalMailboxes,
        missingRequiredMailboxes,
      };
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
      mode?: DraftMode | undefined;
    }) {
      const account = await requireAccountPermission(context.userId, accountId, "send");
      const engine = await engineFor(accountId, "send");
      const mode = input.mode ?? (input.inReplyTo ? "reply" : "new");
      const preferences = await resolveComposePreferences(context.userId, account.address, mode);
      const body = applySignature({
        textBody: input.textBody,
        htmlBody: input.htmlBody ? sanitizeRichText(input.htmlBody) : undefined,
        richText: preferences.richText,
        signature: preferences.signature,
      });
      const engineId = await engine.saveDraft(accountId, {
        from: account.address,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        textBody: body.textBody,
        htmlBody: body.htmlBody,
        replyTo: input.replyTo,
        inReplyTo: input.inReplyTo,
        references: input.references,
      });
      return { engineId, templateKey: preferences.templateKey, signatureApplied: Boolean(preferences.signature) };
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
      const preferences = await resolveComposePreferences(context.userId, account.address, draft.headers["In-Reply-To"] ? "reply" : "new");
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
        templateKey: preferences.templateKey,
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
