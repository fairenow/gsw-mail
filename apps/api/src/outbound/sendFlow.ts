import { config } from "../config.js";
import { getEngine } from "../engine/index.js";
import { badRequest, conflict } from "../lib/errors.js";
import { generateMessageId } from "../lib/messageId.js";
import type { AccessibleAccount } from "../auth/authorize.js";
import { checkSuppressions } from "./delivery.js";
import {
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
  account: AccessibleAccount;
  to: string[];
  cc?: string[] | undefined;
  bcc?: string[] | undefined;
  subject?: string | undefined;
  textBody?: string | undefined;
  htmlBody?: string | undefined;
  replyTo?: string | undefined;
  inReplyTo?: string | undefined;
  references?: string | undefined;
  attachments?:
    | { filename: string; contentType: string; size: number; contentDisposition?: string | undefined; contentId?: string | undefined }[]
    | undefined;
  clientRequestId?: string | undefined;
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
  const engine = getEngine();

  const reserve = await reserveSendOperation({
    accountId: input.account.id,
    fromAddress: input.account.address,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    textBody: input.textBody,
    htmlBody: input.htmlBody,
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
    (input.attachments ?? []).map((a) => ({ ...a, engineAttachmentId: null })),
  );

  let sent;
  try {
    sent = await engine.saveSent(input.account.id, {
      from: input.account.address,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      textBody: input.textBody,
      htmlBody: input.htmlBody,
      replyTo: input.replyTo,
      inReplyTo: input.inReplyTo,
      references: input.references,
      messageId,
    });
  } catch (err) {
    await failSendPreparation(reserve.id, "sent_persistence", err instanceof Error ? err.message : String(err));
    throw new Error("failed to persist sent message");
  }

  await finalizeSend(reserve.id, { engineMessageId: sent.engineMessageId, engineThreadId: sent.threadId }, nextAttemptAt);

  return {
    sendId: reserve.id,
    messageId,
    threadId: sent.threadId,
    transportStatus: "queued",
    undoUntil: config.send.delaySeconds > 0 ? nextAttemptAt.toISOString() : null,
  };
}