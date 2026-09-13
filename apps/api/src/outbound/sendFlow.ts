import { config } from "../config.js";
import { getEngine } from "../engine/index.js";
import type { SendAttachment } from "../engine/types.js";
import { badRequest, conflict } from "../lib/errors.js";
import { generateMessageId } from "../lib/messageId.js";
import type { AccessibleAccount } from "../auth/authorize.js";
import { checkSuppressions } from "./delivery.js";
import { recordSentRecipients } from "../lib/contacts.js";
import { DEFAULT_MAIL_TEMPLATE_KEY, renderMailTemplate } from "../mail/templates/index.js";
import { richTextToPlainText, sanitizeRichText } from "../lib/richText.js";
import { db } from "../db/client.js";
import { emailSignatures } from "../db/schema.js";
import { eq } from "drizzle-orm";
import {
  backfillOutboundAttachmentEngineIds,
  checkSendRate,
  failSendPreparation,
  finalizeSend,
  getSendStatus,
  insertOutboundAttachments,
  insertRecipients,
  reserveSendOperation,
} from "./queue.js";

export interface SubmitSendInput {
  userId: string;
  accessToken?: string | undefined;
  account: AccessibleAccount;
  to: string[];
  cc?: string[] | undefined;
  bcc?: string[] | undefined;
  subject?: string | undefined;
  textBody?: string | undefined;
  htmlBody?: string | undefined;
  templateKey?: string | undefined;
  replyTo?: string | undefined;
  inReplyTo?: string | undefined;
  references?: string | undefined;
  attachments?: SendAttachment[] | undefined;
  clientRequestId?: string | undefined;
  mode?: "new" | "reply" | "replyAll" | "forward" | undefined;
}

export interface SubmitSendResult {
  sendId: string;
  messageId: string | null;
  threadId: string | null;
  transportStatus: string;
  undoUntil: string | null;
  idempotentReplay?: boolean;
}

export async function submitSend(input: SubmitSendInput): Promise<SubmitSendResult> {
  if (input.account.status !== "active") throw badRequest("account is not active");
  const recipientEmails = [input.to, input.cc ?? [], input.bcc ?? []].flat();
  if (recipientEmails.length > config.send.maxRecipients) {
    throw badRequest(`too many recipients (max ${config.send.maxRecipients})`);
  }
  if (recipientEmails.length === 0) throw badRequest("at least one recipient is required");

  const suppressed = await checkSuppressions(input.account.organizationId, recipientEmails);
  if (suppressed.length > 0) {
    throw conflict(`recipient is suppressed and cannot receive mail: ${suppressed.join(", ")}`);
  }

  await checkSendRate(input.account.id);

  const now = new Date();
  const nextAttemptAt = new Date(now.getTime() + config.send.delaySeconds * 1000);
  const messageId = generateMessageId();
  const engine = getEngine(input.accessToken);
  const templateKey = input.templateKey ?? DEFAULT_MAIL_TEMPLATE_KEY;
  const safeHtml = input.htmlBody ? sanitizeRichText(input.htmlBody) : undefined;
  const [signature] = await db.select().from(emailSignatures).where(eq(emailSignatures.userId, input.userId)).limit(1);
  const mode = input.mode ?? "new";
  const signatureEnabled = signature?.enabled && ((mode === "new" && signature.onNew) || ((mode === "reply" || mode === "replyAll") && signature.onReply) || (mode === "forward" && signature.onForward));
  const signatureIncluded = safeHtml?.includes("gsw-signature") ?? false;
  const signatureHtml = signatureEnabled && !signatureIncluded && (signature.signatureHtml || signature.signatureText) ? `<div class="gsw-signature">${sanitizeRichText(signature.signatureHtml)}</div><div><br></div>` : "";
  const messageHtml = signatureHtml ? signature?.position === "afterQuotedText" ? `${safeHtml ?? ""}${signatureHtml}` : `${signatureHtml}${safeHtml ?? ""}` : safeHtml;
  const messageText = input.textBody ?? (safeHtml ? richTextToPlainText(safeHtml) : "");
  const signatureText = signatureHtml ? signature?.position === "afterQuotedText" ? `${messageText}\n\n${signature?.signatureText ?? ""}` : `${signature?.signatureText ?? ""}\n\n${messageText}` : messageText;
  const rendered = renderMailTemplate(templateKey, {
    bodyHtml: messageHtml,
    bodyText: signatureText,
    senderName: input.account.displayName ?? undefined,
    senderEmail: input.account.address,
  });

  const reserve = await reserveSendOperation({
    accountId: input.account.id,
    fromAddress: input.account.address,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    textBody: rendered.text,
    htmlBody: rendered.html,
    templateKey,
    replyTo: input.replyTo,
    inReplyTo: input.inReplyTo,
    references: input.references,
    messageId,
    attachments: input.attachments,
    clientRequestId: input.clientRequestId,
    undoUntil: config.send.delaySeconds > 0 ? nextAttemptAt : undefined,
  });

  if (!reserve.reserved) {
    const existing = await getSendStatus(reserve.id);
    if (!existing) throw new Error("send operation conflict without existing row");
    return {
      sendId: existing.id,
      messageId: existing.messageId,
      threadId: existing.engineThreadId,
      transportStatus: existing.transportStatus,
      undoUntil: existing.undoUntil?.toISOString() ?? null,
      idempotentReplay: true,
    };
  }

  await insertRecipients(reserve.id, input.to, input.cc ?? [], input.bcc ?? []);
  await insertOutboundAttachments(
    reserve.id,
    (input.attachments ?? []).map(({ content: _content, ...a }) => ({ ...a, engineAttachmentId: null })),
  );

  let sent;
  try {
    sent = await engine.saveSent(input.account.id, {
      from: input.account.address,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      textBody: rendered.text,
      htmlBody: rendered.html,
      replyTo: input.replyTo,
      inReplyTo: input.inReplyTo,
      references: input.references,
      messageId,
      attachments: input.attachments,
    });
  } catch (err) {
    await failSendPreparation(reserve.id, "sent_persistence", err instanceof Error ? err.message : String(err));
    throw new Error("failed to persist sent message", { cause: err });
  }

  if (sent.attachments?.length) {
    await backfillOutboundAttachmentEngineIds(
      reserve.id,
      sent.attachments.map((a) => ({ engineId: a.engineId, filename: a.filename })),
    );
  }

  await finalizeSend(reserve.id, { engineMessageId: sent.engineMessageId, engineThreadId: sent.threadId }, nextAttemptAt);
  void recordSentRecipients(input.userId, recipientEmails, { engine, accountId: input.account.id }).catch(() => undefined);

  return {
    sendId: reserve.id,
    messageId,
    threadId: sent.threadId,
    transportStatus: "queued",
    undoUntil: config.send.delaySeconds > 0 ? nextAttemptAt.toISOString() : null,
  };
}
