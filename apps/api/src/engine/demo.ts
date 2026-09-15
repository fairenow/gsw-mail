import type {
  AttachmentBody,
  AttachmentMeta,
  EngineAddressBook,
  EngineAccountId,
  EngineCalendar,
  EngineCalendarEvent,
  EngineContact,
  EngineContactInput,
  EngineMessageId,
  EngineThreadId,
  FullMessage,
  MailboxName,
  MailboxStats,
  MailEngine,
  MailEngineStatus,
  MessageQuery,
  MessageSummary,
  SendDraftInput,
  SendResult,
} from "./types.js";

const MAILBOXES: MailboxName[] = [
  { role: "inbox", engineName: "Inbox" },
  { role: "sent", engineName: "Sent" },
  { role: "drafts", engineName: "Drafts" },
  { role: "spam", engineName: "Spam" },
  { role: "trash", engineName: "Trash" },
  { role: "archive", engineName: "Archive" },
];

let seq = 0;

const sample = (accountId: EngineAccountId): FullMessage[] => {
  const now = new Date();
  const make = (
    threadId: EngineThreadId,
    mailbox: string,
    subject: string,
    from: string,
    textBody: string,
    minutesAgo: number,
  ): FullMessage => ({
    engineId: `demo-${++seq}`,
    threadId,
    mailbox,
    from: { email: from },
    to: [{ email: `user@${"demo"}` }],
    cc: [],
    subject,
    textBody,
    snippet: textBody.slice(0, 80),
    date: new Date(now.getTime() - minutesAgo * 60_000),
    size: textBody.length,
    read: false,
    flagged: false,
    hasAttachments: false,
    keywords: [],
    attachments: [],
    headers: { "Message-ID": `<demo-${seq}@demo>` },
    security: { spf: "pass", dkim: "pass", dmarc: "pass", spamScore: 0.4 },
  });

  void accountId;
  return [
    make(
      "t-1",
      "Inbox",
      "Welcome to Guided Steps Mail",
      "ramon@guidedstepswellness.com",
      "Your own mail platform is live.",
      360,
    ),
    make(
      "t-2",
      "Inbox",
      "Referral: please contact our youth director",
      "pastor@examplechurch.org",
      'Please contact our youth director instead. Her email is sarah@examplechurch.org.',
      90,
    ),
    make(
      "t-1",
      "Inbox",
      "Re: Welcome to Guided Steps Mail",
      "alyssa@guidedstepswellness.com",
      "Looks great!",
      45,
    ),
    make(
      "t-3",
      "Inbox",
      "Invoice from the provider",
      "billing@vendor.net",
      "Attached is your monthly statement.",
      10,
    ),
  ];
};

const messages = new Map<EngineAccountId, FullMessage[]>();
const rfcMessageIds = new Map<string, { accountId: EngineAccountId; engineId: EngineMessageId; threadId: EngineThreadId }>();
const attachmentBodies = new Map<string, { contentType: string; content: Buffer }>();
const contacts = new Map<EngineAccountId, EngineContact[]>();
const addressBooks = new Map<EngineAccountId, EngineAddressBook[]>();

export class DemoEngine implements MailEngine {
  readonly name = "demo";

  private store(accountId: EngineAccountId): FullMessage[] {
    let list = messages.get(accountId);
    if (!list) {
      list = sample(accountId);
      messages.set(accountId, list);
    }
    return list;
  }

  async listMailboxes(_accountId: EngineAccountId): Promise<MailboxName[]> {
    return MAILBOXES;
  }

  async listMailboxStats(accountId: EngineAccountId): Promise<MailboxStats[]> {
    const all = this.store(accountId);
    return MAILBOXES.map((mailbox) => ({
      role: mailbox.role!,
      total: all.filter((message) => message.mailbox === mailbox.engineName).length,
      unread: all.filter((message) => message.mailbox === mailbox.engineName && !message.read).length,
    }));
  }

  async listMessages(accountId: EngineAccountId, query: MessageQuery): Promise<MessageSummary[]> {
    const all = this.store(accountId);
    const filtered = all.filter(
      (m) => (!query.mailbox || m.mailbox === query.mailbox) && (!query.threadId || m.threadId === query.threadId),
    );
    const end = (query.offset ?? 0) + (query.limit ?? 50);
    return filtered.slice(query.offset ?? 0, end).map(stripBody);
  }

  async getMessage(accountId: EngineAccountId, messageId: EngineMessageId): Promise<FullMessage | null> {
    const found = this.store(accountId).find((m) => m.engineId === messageId);
    return found ? { ...found } : null;
  }

  async getThread(accountId: EngineAccountId, threadId: EngineThreadId): Promise<MessageSummary[]> {
    return this.store(accountId)
      .filter((m) => m.threadId === threadId)
      .map(stripBody);
  }

  async setSeen(accountId: EngineAccountId, messageIds: EngineMessageId[], seen: boolean): Promise<void> {
    for (const m of this.store(accountId)) {
      if (messageIds.includes(m.engineId)) m.read = seen;
    }
  }

  async setFlagged(accountId: EngineAccountId, messageIds: EngineMessageId[], flagged: boolean): Promise<void> {
    for (const m of this.store(accountId)) {
      if (messageIds.includes(m.engineId)) m.flagged = flagged;
    }
  }

  async move(accountId: EngineAccountId, messageIds: EngineMessageId[], toMailbox: string): Promise<void> {
    for (const m of this.store(accountId)) {
      if (messageIds.includes(m.engineId)) m.mailbox = toMailbox;
    }
  }

  async destroy(accountId: EngineAccountId, messageIds: EngineMessageId[]): Promise<void> {
    const remaining = this.store(accountId).filter((message) => !messageIds.includes(message.engineId));
    messages.set(accountId, remaining);
  }

  async saveDraft(accountId: EngineAccountId, input: SendDraftInput): Promise<EngineMessageId> {
    const id = `demo-${++seq}`;
    this.store(accountId).push({
      engineId: id,
      threadId: `draft-${id}`,
      mailbox: "Drafts",
      to: input.to.map((email) => ({ email })),
      cc: (input.cc ?? []).map((email) => ({ email })),
      subject: input.subject ?? "",
      textBody: input.textBody,
      htmlBody: input.htmlBody,
      snippet: input.textBody?.slice(0, 80),
      date: new Date(),
      size: (input.textBody ?? "").length,
      read: true,
      flagged: false,
      hasAttachments: false,
      keywords: [],
      attachments: [],
      headers: {},
    });
    return id;
  }

  async updateDraft(accountId: EngineAccountId, messageId: EngineMessageId, input: SendDraftInput): Promise<EngineMessageId> {
    const draft = this.store(accountId).find((message) => message.engineId === messageId && message.mailbox === "Drafts");
    if (!draft) throw new Error("draft not found");
    draft.to = input.to.map((email) => ({ email }));
    draft.cc = (input.cc ?? []).map((email) => ({ email }));
    draft.subject = input.subject ?? "";
    draft.textBody = input.textBody;
    draft.htmlBody = input.htmlBody;
    draft.snippet = input.textBody?.slice(0, 80);
    draft.size = (input.textBody ?? "").length;
    draft.date = new Date();
    draft.headers = {
      ...(input.inReplyTo ? { "In-Reply-To": input.inReplyTo } : {}),
      ...(input.references ? { References: input.references } : {}),
    };
    return messageId;
  }

  async saveSent(accountId: EngineAccountId, input: SendDraftInput): Promise<SendResult> {
    const id = `demo-${++seq}`;
    const threadId = `t-sent-${id}`;
    const messageId = input.messageId ?? `<${id}@demo>`;
    const attachments: AttachmentMeta[] = (input.attachments ?? []).map((a) => {
      const engineId = a.engineId ?? `demo-att-${++seq}`;
      const content = a.content ? Buffer.from(a.content, "base64") : Buffer.from(`${a.filename} demo bytes`);
      attachmentBodies.set(`${accountId}:${engineId}`, { contentType: a.contentType, content });
      return {
        engineId,
        filename: a.filename,
        contentType: a.contentType,
        size: content.byteLength,
        inline: a.contentDisposition === "inline",
      };
    });
    this.store(accountId).push({
      engineId: id,
      threadId,
      mailbox: "Sent",
      from: { email: input.from },
      to: input.to.map((email) => ({ email })),
      cc: (input.cc ?? []).map((email) => ({ email })),
      subject: input.subject ?? "",
      textBody: input.textBody,
      htmlBody: input.htmlBody,
      snippet: input.textBody?.slice(0, 80),
      date: new Date(),
      size: (input.textBody ?? "").length,
      read: true,
      flagged: false,
      hasAttachments: attachments.length > 0,
      keywords: [],
      attachments,
      headers: { "Message-ID": messageId, ...(input.inReplyTo ? { "In-Reply-To": input.inReplyTo } : {}) },
    });
    rfcMessageIds.set(messageId, { accountId, engineId: id, threadId });
    return { engineMessageId: id, threadId, attachments };
  }

  async getAttachment(accountId: EngineAccountId, attachmentEngineId: string): Promise<AttachmentBody | null> {
    const body = attachmentBodies.get(`${accountId}:${attachmentEngineId}`);
    return body ? { ...body } : null;
  }

  async listAddressBooks(accountId: EngineAccountId): Promise<EngineAddressBook[]> {
    const existing = addressBooks.get(accountId);
    if (existing) return existing;
    const created = [{ engineId: `demo-address-book-${accountId}`, name: "Personal", isDefault: true }];
    addressBooks.set(accountId, created);
    return created;
  }

  async listCalendars(accountId: EngineAccountId): Promise<EngineCalendar[]> {
    return [{ engineId: `demo-calendar-${accountId}`, name: "Personal", isDefault: true, timeZone: "UTC" }];
  }

  async listCalendarEvents(_accountId: EngineAccountId, _after: string, _before: string): Promise<EngineCalendarEvent[]> {
    return [];
  }

  async listContacts(accountId: EngineAccountId): Promise<EngineContact[]> {
    return contacts.get(accountId)?.map(cloneContact) ?? [];
  }

  async getContact(accountId: EngineAccountId, contactId: string): Promise<EngineContact | null> {
    const contact = contacts.get(accountId)?.find((item) => item.engineId === contactId);
    return contact ? cloneContact(contact) : null;
  }

  async createContact(accountId: EngineAccountId, input: EngineContactInput): Promise<EngineContact> {
    const books = input.addressBookIds ?? [(await this.listAddressBooks(accountId))[0]!.engineId];
    const contact: EngineContact = { ...input, engineId: `demo-contact-${++seq}`, addressBookIds: books, emails: input.emails.map((item) => ({ ...item })), phones: input.phones.map((item) => ({ ...item })) };
    const accountContacts = contacts.get(accountId) ?? [];
    accountContacts.push(contact);
    contacts.set(accountId, accountContacts);
    return cloneContact(contact);
  }

  async updateContact(accountId: EngineAccountId, contactId: string, input: EngineContactInput): Promise<EngineContact> {
    const contact = contacts.get(accountId)?.find((item) => item.engineId === contactId);
    if (!contact) throw new Error("contact not found");
    Object.assign(contact, { ...input, addressBookIds: input.addressBookIds ?? contact.addressBookIds, emails: input.emails.map((item) => ({ ...item })), phones: input.phones.map((item) => ({ ...item })) });
    return cloneContact(contact);
  }

  async findMessageByRfcMessageId(
    accountId: EngineAccountId,
    messageId: string,
  ): Promise<{ engineMessageId: EngineMessageId; engineThreadId: EngineThreadId } | null> {
    const mapped = rfcMessageIds.get(messageId);
    if (mapped && mapped.accountId === accountId) return { engineMessageId: mapped.engineId, engineThreadId: mapped.threadId };
    const found = this.store(accountId).find((m) => m.headers["Message-ID"] === messageId);
    return found ? { engineMessageId: found.engineId, engineThreadId: found.threadId } : null;
  }

  async search(accountId: EngineAccountId, q: string, mailbox?: string): Promise<MessageSummary[]> {
    const needle = q.toLowerCase();
    return this.store(accountId)
      .filter((m) => {
        if (mailbox && m.mailbox !== mailbox) return false;
        const haystack = `${m.subject} ${m.textBody ?? ""} ${m.from?.email ?? ""} ${m.to.map((a) => a.email).join(" ")}`.toLowerCase();
        return haystack.includes(needle);
      })
      .map(stripBody);
  }

  async status(): Promise<MailEngineStatus> {
    return { name: this.name, ok: true };
  }
}

const stripBody = (m: FullMessage): MessageSummary => {
  const { textBody: _textBody, htmlBody: _htmlBody, attachments: _attachments, headers: _headers, ...summary } = m;
  return summary;
};

const cloneContact = (contact: EngineContact): EngineContact => ({ ...contact, addressBookIds: [...contact.addressBookIds], emails: contact.emails.map((item) => ({ ...item })), phones: contact.phones.map((item) => ({ ...item })) });
