export type EngineAccountId = string;
export type EngineMessageId = string;
export type EngineThreadId = string;
export type EngineMailboxId = string;

export interface MailboxName {
  role: "inbox" | "sent" | "drafts" | "spam" | "trash" | "archive";
  engineName: string;
  engineId?: EngineMailboxId;
}

export interface MessageAddress {
  name?: string;
  email: string;
}

export interface MessageSummary {
  engineId: EngineMessageId;
  threadId: EngineThreadId;
  mailbox: string;
  from?: MessageAddress;
  to: MessageAddress[];
  cc: MessageAddress[];
  subject: string;
  snippet?: string | undefined;
  date: Date;
  size: number;
  read: boolean;
  flagged: boolean;
  hasAttachments: boolean;
  keywords: string[];
  security?: SecurityMetadata;
}

export interface SecurityMetadata {
  spf?: string;
  dkim?: string;
  dmarc?: string;
  spamScore?: number;
}

export interface AttachmentMeta {
  engineId: string;
  filename: string;
  contentType: string;
  size: number;
  inline: boolean;
}

export interface FullMessage extends MessageSummary {
  textBody?: string | undefined;
  htmlBody?: string | undefined;
  attachments: AttachmentMeta[];
  headers: Record<string, string>;
}

export interface SendAttachment {
  engineId?: string | undefined;
  filename: string;
  contentType: string;
  size: number;
  contentDisposition?: string | undefined;
  contentId?: string | undefined;
  /** base64-encoded bytes, used by the demo engine and ignored by remote engines */
  content?: string | undefined;
}

export interface SendDraftInput {
  from: string;
  to: string[];
  cc?: string[] | undefined;
  bcc?: string[] | undefined;
  subject?: string | undefined;
  textBody?: string | undefined;
  htmlBody?: string | undefined;
  replyTo?: string | undefined;
  inReplyTo?: string | undefined;
  references?: string | undefined;
  messageId?: string | undefined;
  attachments?: SendAttachment[] | undefined;
}

export interface SendResult {
  engineMessageId: EngineMessageId;
  threadId: EngineThreadId;
  attachments?: AttachmentMeta[] | undefined;
}

export interface AttachmentBody {
  contentType: string;
  content: Buffer;
}

export interface MessageQuery {
  mailbox?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  threadId?: EngineThreadId | undefined;
}

export interface MailEngineStatus {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface MailEngine {
  readonly name: string;

  listMailboxes(accountId: EngineAccountId): Promise<MailboxName[]>;

  listMessages(accountId: EngineAccountId, query: MessageQuery): Promise<MessageSummary[]>;

  getMessage(accountId: EngineAccountId, messageId: EngineMessageId): Promise<FullMessage | null>;

  getThread(accountId: EngineAccountId, threadId: EngineThreadId): Promise<MessageSummary[]>;

  setSeen(accountId: EngineAccountId, messageIds: EngineMessageId[], seen: boolean): Promise<void>;

  setFlagged(accountId: EngineAccountId, messageIds: EngineMessageId[], flagged: boolean): Promise<void>;

  move(accountId: EngineAccountId, messageIds: EngineMessageId[], toMailbox: string): Promise<void>;

  saveDraft(accountId: EngineAccountId, input: SendDraftInput): Promise<EngineMessageId>;

  updateDraft(accountId: EngineAccountId, messageId: EngineMessageId, input: SendDraftInput): Promise<void>;

  saveSent(accountId: EngineAccountId, input: SendDraftInput): Promise<SendResult>;

  findMessageByRfcMessageId(
    accountId: EngineAccountId,
    messageId: string,
  ): Promise<{ engineMessageId: EngineMessageId; engineThreadId: EngineThreadId } | null>;

  getAttachment(accountId: EngineAccountId, attachmentEngineId: string): Promise<AttachmentBody | null>;

  search(accountId: EngineAccountId, q: string, mailbox?: string | undefined): Promise<MessageSummary[]>;

  status(): Promise<MailEngineStatus>;
}
