export type EngineAccountId = string;
export type EngineMessageId = string;
export type EngineThreadId = string;
export type EngineMailboxId = string;

export interface EngineAddressBook {
  engineId: string;
  name: string;
  isDefault: boolean;
}

export interface EngineCalendar {
  engineId: string;
  name: string;
  color?: string | undefined;
  isDefault: boolean;
  timeZone?: string | undefined;
}

export interface EngineCalendarEvent {
  engineId: string;
  calendarIds: string[];
  title: string;
  description?: string | undefined;
  start: string;
  end?: string | undefined;
  location?: string | undefined;
  allDay: boolean;
}

export interface EngineCalendarEventInput {
  calendarId: string;
  title: string;
  description?: string | undefined;
  start: string;
  durationMinutes: number;
  location?: string | undefined;
  timeZone?: string | undefined;
  allDay: boolean;
}

export interface EngineContactValue {
  value: string;
  label?: string | undefined;
  isPrimary?: boolean | undefined;
}

export interface EngineContact {
  engineId: string;
  addressBookIds: string[];
  firstName?: string | undefined;
  middleName?: string | undefined;
  lastName?: string | undefined;
  displayName?: string | undefined;
  organization?: string | undefined;
  jobTitle?: string | undefined;
  website?: string | undefined;
  address?: string | undefined;
  city?: string | undefined;
  state?: string | undefined;
  postalCode?: string | undefined;
  country?: string | undefined;
  emails: EngineContactValue[];
  phones: EngineContactValue[];
}

export type EngineContactInput = Omit<EngineContact, "engineId" | "addressBookIds"> & { addressBookIds?: string[] | undefined };

export interface MailboxName {
  role: "inbox" | "sent" | "drafts" | "spam" | "trash" | "archive" | null;
  engineName: string;
  engineId?: EngineMailboxId;
}

export interface MailboxStats {
  role: Exclude<MailboxName["role"], null>;
  total: number;
  unread: number;
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

  listMailboxStats(accountId: EngineAccountId): Promise<MailboxStats[]>;

  listMessages(accountId: EngineAccountId, query: MessageQuery): Promise<MessageSummary[]>;

  getMessage(accountId: EngineAccountId, messageId: EngineMessageId): Promise<FullMessage | null>;

  getThread(accountId: EngineAccountId, threadId: EngineThreadId): Promise<MessageSummary[]>;

  setSeen(accountId: EngineAccountId, messageIds: EngineMessageId[], seen: boolean): Promise<void>;

  setFlagged(accountId: EngineAccountId, messageIds: EngineMessageId[], flagged: boolean): Promise<void>;

  move(accountId: EngineAccountId, messageIds: EngineMessageId[], toMailbox: string): Promise<void>;

  destroy(accountId: EngineAccountId, messageIds: EngineMessageId[]): Promise<void>;

  saveDraft(accountId: EngineAccountId, input: SendDraftInput): Promise<EngineMessageId>;

  updateDraft(accountId: EngineAccountId, messageId: EngineMessageId, input: SendDraftInput): Promise<EngineMessageId>;

  saveSent(accountId: EngineAccountId, input: SendDraftInput): Promise<SendResult>;

  findMessageByRfcMessageId(
    accountId: EngineAccountId,
    messageId: string,
  ): Promise<{ engineMessageId: EngineMessageId; engineThreadId: EngineThreadId } | null>;

  getAttachment(accountId: EngineAccountId, attachmentEngineId: string): Promise<AttachmentBody | null>;

  listAddressBooks(accountId: EngineAccountId): Promise<EngineAddressBook[]>;

  listCalendars(accountId: EngineAccountId): Promise<EngineCalendar[]>;

  listCalendarEvents(accountId: EngineAccountId, after: string, before: string): Promise<EngineCalendarEvent[]>;

  createCalendarEvent(accountId: EngineAccountId, input: EngineCalendarEventInput): Promise<EngineCalendarEvent>;

  updateCalendarEvent(accountId: EngineAccountId, eventId: string, input: EngineCalendarEventInput): Promise<EngineCalendarEvent>;

  destroyCalendarEvent(accountId: EngineAccountId, eventId: string): Promise<void>;

  listContacts(accountId: EngineAccountId): Promise<EngineContact[]>;

  getContact(accountId: EngineAccountId, contactId: string): Promise<EngineContact | null>;

  createContact(accountId: EngineAccountId, input: EngineContactInput): Promise<EngineContact>;

  updateContact(accountId: EngineAccountId, contactId: string, input: EngineContactInput): Promise<EngineContact>;

  search(accountId: EngineAccountId, q: string, mailbox?: string | undefined): Promise<MessageSummary[]>;

  status(): Promise<MailEngineStatus>;
}
