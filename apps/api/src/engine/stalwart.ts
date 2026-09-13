import { JmapClient, type JmapSession } from "./jmap.js";
import type {
  AttachmentBody,
  AttachmentMeta,
  EngineAccountId,
  EngineMessageId,
  EngineThreadId,
  FullMessage,
  MailboxName,
  MailEngine,
  MailEngineStatus,
  MessageAddress,
  MessageQuery,
  MessageSummary,
  SendDraftInput,
  SendResult,
} from "./types.js";

export interface StalwartOptions {
  resolveAccount?: (productAccountId: string) => Promise<string>;
  jmapUrl: string;
  accessToken?: string;
  serviceUsername?: string;
  servicePassword?: string;
  sessionTtlMs?: number;
  fetchImpl?: typeof fetch;
}

interface JmapMailbox {
  id: string;
  name: string;
  role?: string | null;
  sortOrder?: number;
}

interface JmapEmailAddress {
  email: string;
  name?: string | null;
}

interface JmapEmail {
  id: string;
  blobId?: string;
  threadId: string;
  mailboxIds: Record<string, boolean>;
  keywords?: Record<string, boolean>;
  size?: number;
  receivedAt?: string;
  sentAt?: string;
  subject?: string;
  from?: JmapEmailAddress[];
  to?: JmapEmailAddress[];
  cc?: JmapEmailAddress[];
  bcc?: JmapEmailAddress[];
  replyTo?: JmapEmailAddress[];
  inReplyTo?: string;
  references?: string;
  messageId?: string;
  hasAttachment?: boolean;
  attachments?: {
    blobId: string;
    name?: string | null;
    type?: string | null;
    size?: number;
    disposition?: string | null;
    isInline?: boolean;
  }[];
  textBody?: { partId: string; type?: string; size?: number }[];
  htmlBody?: { partId: string; type?: string; size?: number }[];
  bodyValues?: Record<string, { value?: string; isTruncated?: boolean }>;
  "header:Message-ID"?: string | null;
  "header:In-Reply-To"?: string | null;
  "header:References"?: string | null;
}

interface JmapGetResponse {
  list: JmapEmail[];
  notFound?: string[];
  state?: string;
}

const GET_PROPERTIES = [
  "id",
  "blobId",
  "threadId",
  "mailboxIds",
  "keywords",
  "size",
  "receivedAt",
  "sentAt",
  "subject",
  "from",
  "to",
  "cc",
  "bcc",
  "replyTo",
  "inReplyTo",
  "references",
  "messageId",
  "hasAttachment",
  "attachments",
  "textBody",
  "htmlBody",
  "header:Message-ID",
  "header:In-Reply-To",
  "header:References",
] as const;

const ROLE_TO_ENGINE: Record<string, MailboxName["role"]> = {
  inbox: "inbox",
  sent: "sent",
  drafts: "drafts",
  spam: "spam",
  junk: "spam",
  trash: "trash",
  archive: "archive",
};

const toAddress = (a?: JmapEmailAddress[]): MessageAddress[] =>
  (a ?? []).map((x) => ({
    email: x.email,
    ...(x.name ? { name: x.name } : {}),
  }));

const firstFrom = (a?: JmapEmailAddress[]): MessageAddress | undefined => {
  const f = a?.[0];
  return f
    ? {
        email: f.email,
        ...(f.name ? { name: f.name } : {}),
      }
    : undefined;
};

const snippetOf = (email: JmapEmail): string => {
  const partId = email.textBody?.[0]?.partId;
  const value = partId ? email.bodyValues?.[partId]?.value ?? "" : "";
  return value.replace(/\s+/g, " ").trim().slice(0, 200);
};

const renderTemplate = (template: string, vars: Record<string, string>): string =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, v), template);

export class StalwartEngine implements MailEngine {
  readonly name = "stalwart";
  private readonly client: JmapClient;
  private readonly mailboxes = new Map<EngineAccountId, MailboxName[]>();

  constructor(private readonly opts: StalwartOptions) {
    this.client = new JmapClient({
      baseUrl: opts.jmapUrl,
      ...(opts.accessToken ? { token: opts.accessToken } : {}),
      ...(opts.serviceUsername ? { username: opts.serviceUsername } : {}),
      ...(opts.servicePassword ? { password: opts.servicePassword } : {}),
      sessionTtlMs: opts.sessionTtlMs ?? 60_000,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    });
  }

  private async accountIdOf(engineAccountId: EngineAccountId): Promise<{ session: JmapSession; accountId: string }> {
    const session = await this.client.session();
    return { session, accountId: this.client.resolveAccountId(session, this.opts.resolveAccount ? await this.opts.resolveAccount(engineAccountId) : engineAccountId) };
  }

  async listMailboxes(engineAccountId: EngineAccountId): Promise<MailboxName[]> {
    const session = await this.client.session();
    const accountId = this.client.resolveAccountId(session, this.opts.resolveAccount ? await this.opts.resolveAccount(engineAccountId) : engineAccountId);
    const responses = await this.client.call([
      [
        "Mailbox/get",
        {
          accountId,
          ids: null,
          properties: ["id", "name", "role", "sortOrder"],
        },
        "m1",
      ],
    ]);
    const payload = responses[0]![1];
    const list = (payload.list ?? []) as JmapMailbox[];
    const mailboxes = list
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map<MailboxName>((m) => ({
        engineId: m.id,
        role: m.role ? (ROLE_TO_ENGINE[m.role.toLowerCase()] ?? "archive") : "archive",
        engineName: m.name,
      }));
    this.mailboxes.set(engineAccountId, mailboxes);
    return mailboxes;
  }

  private async ensureMailboxes(engineAccountId: EngineAccountId): Promise<MailboxName[]> {
    const cached = this.mailboxes.get(engineAccountId);
    if (cached) return cached;
    return this.listMailboxes(engineAccountId);
  }

  private async mailboxIdByName(engineAccountId: EngineAccountId, roleOrName: string): Promise<string | null> {
    const mailboxes = await this.ensureMailboxes(engineAccountId);
    const needle = roleOrName.toLowerCase();
    let match = mailboxes.find((m) => m.role === roleOrName || m.engineName.toLowerCase() === needle || (m.engineId === roleOrName));
    if (!match) {
      match = mailboxes.find((m) => m.role.toLowerCase() === needle);
    }
    return match?.engineId ?? null;
  }

  private async mailboxNameById(engineAccountId: EngineAccountId, id: string): Promise<string> {
    const mailboxes = await this.ensureMailboxes(engineAccountId);
    return mailboxes.find((m) => m.engineId === id)?.engineName ?? id;
  }

  private async roleToEngineName(engineAccountId: EngineAccountId, role: MailboxName["role"]): Promise<string> {
    const mailboxes = await this.ensureMailboxes(engineAccountId);
    const found = mailboxes.find((m) => m.role === role);
    if (found) return found.engineName;
    const fallback = mailboxes[0]?.engineName;
    if (fallback) return fallback;
    return role;
  }

  private async queryEmails(
    engineAccountId: EngineAccountId,
    filter: Record<string, unknown>,
    { position = 0, limit = 50 }: { position?: number; limit?: number },
  ): Promise<JmapEmail[]> {
    const { accountId } = await this.accountIdOf(engineAccountId);
    const responses = await this.client.call([
      [
        "Email/query",
        {
          accountId,
          filter,
          sort: [{ property: "receivedAt", isAscending: false }],
          position,
          limit,
          calculateTotal: undefined,
        },
        "q1",
      ],
      [
        "Email/get",
        {
          accountId,
          "#ids": { resultOf: "q1", name: "Email/query", path: "/ids" },
          properties: GET_PROPERTIES as unknown as string[],
          fetchTextBodyValues: true,
          fetchHTMLBodyValues: true,
          fetchAllBodyValues: true,
        },
        "g1",
      ],
    ]);
    const payload = responses[1]![1] as unknown as JmapGetResponse;
    return payload.list ?? [];
  }

  private toSummary(engineAccountId: EngineAccountId, email: JmapEmail): MessageSummary {
    const mailbox = Object.keys(email.mailboxIds ?? {})[0] ?? "";
    const from = firstFrom(email.from);
    void engineAccountId;
    return {
      engineId: email.id,
      threadId: email.threadId,
      mailbox,
      ...(from ? { from } : {}),
      to: toAddress(email.to),
      cc: toAddress(email.cc),
      subject: email.subject ?? "",
      snippet: snippetOf(email),
      date: new Date(email.receivedAt ?? email.sentAt ?? Date.now()),
      size: email.size ?? 0,
      read: email.keywords?.["$seen"] === true,
      flagged: email.keywords?.["$flagged"] === true,
      hasAttachments: email.hasAttachment ?? (email.attachments?.length ?? 0) > 0,
      keywords: Object.entries(email.keywords ?? {})
        .filter(([, v]) => v)
        .map(([k]) => k),
    };
  }

  private async summarize(engineAccountId: EngineAccountId, emails: JmapEmail[]): Promise<MessageSummary[]> {
    const summaries: MessageSummary[] = [];
    for (const email of emails) {
      const summary = this.toSummary(engineAccountId, email);
      summary.mailbox = await this.mailboxNameById(engineAccountId, summary.mailbox);
      summaries.push(summary);
    }
    return summaries;
  }

  async listMessages(engineAccountId: EngineAccountId, query: MessageQuery): Promise<MessageSummary[]> {
    const filter: Record<string, unknown> = {};
    if (query.threadId) {
      filter.inThread = query.threadId;
    }
    if (query.mailbox) {
      const id = await this.mailboxIdByName(engineAccountId, query.mailbox);
      if (id) filter.inMailbox = id;
    }
    const emails = await this.queryEmails(engineAccountId, filter, {
      position: query.offset ?? 0,
      limit: query.limit ?? 50,
    });
    return this.summarize(engineAccountId, emails);
  }

  async getMessage(engineAccountId: EngineAccountId, messageId: EngineMessageId): Promise<FullMessage | null> {
    const { accountId } = await this.accountIdOf(engineAccountId);
    const responses = await this.client.call([
      [
        "Email/get",
        {
          accountId,
          ids: [messageId],
          properties: GET_PROPERTIES as unknown as string[],
          fetchTextBodyValues: true,
          fetchHTMLBodyValues: true,
          fetchAllBodyValues: true,
        },
        "g1",
      ],
    ]);
    const payload = responses[0]![1] as unknown as JmapGetResponse;
    const email = payload.list?.[0];
    if (!email) return null;

    const textPartId = email.textBody?.[0]?.partId;
    const htmlPartId = email.htmlBody?.[0]?.partId;
    const attachments: AttachmentMeta[] = (email.attachments ?? []).map((a) => ({
      engineId: a.blobId,
      filename: a.name ?? "attachment",
      contentType: a.type ?? "application/octet-stream",
      size: a.size ?? 0,
      inline: a.isInline ?? (a.disposition === "inline" || a.blobId === `${messageId}`),
    }));

    const summary = this.toSummary(engineAccountId, email);
    const mailbox = await this.mailboxNameById(engineAccountId, summary.mailbox);
    const headers: Record<string, string> = {};
    const headerMap: [string, string | null | undefined][] = [
      ["Message-ID", email["header:Message-ID"] ?? email.messageId],
      ["In-Reply-To", email["header:In-Reply-To"] ?? email.inReplyTo],
      ["References", email["header:References"] ?? email.references],
    ];
    for (const [name, value] of headerMap) {
      if (value) headers[name] = value;
    }

    return {
      ...summary,
      mailbox,
      textBody: textPartId ? email.bodyValues?.[textPartId]?.value ?? "" : undefined,
      htmlBody: htmlPartId ? email.bodyValues?.[htmlPartId]?.value ?? "" : undefined,
      attachments,
      headers,
    };
  }

  async getThread(engineAccountId: EngineAccountId, threadId: EngineThreadId): Promise<MessageSummary[]> {
    const { accountId } = await this.accountIdOf(engineAccountId);
    const responses = await this.client.call([
      [
        "Thread/get",
        {
          accountId,
          ids: [threadId],
          properties: ["id", "emailIds"],
        },
        "t1",
      ],
      [
        "Email/get",
        {
          accountId,
          "#ids": { resultOf: "t1", name: "Thread/get", path: "/list/*/emailIds" },
          properties: GET_PROPERTIES as unknown as string[],
          fetchTextBodyValues: true,
          fetchHTMLBodyValues: true,
          fetchAllBodyValues: true,
        },
        "g1",
      ],
    ]);
    const payload = responses[1]![1] as unknown as JmapGetResponse;
    return this.summarize(engineAccountId, payload.list ?? []);
  }

  async setSeen(engineAccountId: EngineAccountId, messageIds: EngineMessageId[], seen: boolean): Promise<void> {
    await this.updateKeywords(engineAccountId, messageIds, { $seen: seen }, "$seen");
  }

  async setFlagged(engineAccountId: EngineAccountId, messageIds: EngineMessageId[], flagged: boolean): Promise<void> {
    await this.updateKeywords(engineAccountId, messageIds, { $flagged: flagged }, "$flagged");
  }

  private async updateKeywords(
    engineAccountId: EngineAccountId,
    messageIds: EngineMessageId[],
    keywords: Record<string, boolean>,
    keyword: string,
  ): Promise<void> {
    const { accountId } = await this.accountIdOf(engineAccountId);
    const update: Record<string, unknown> = {};
    for (const id of messageIds) update[id] = { keywords, onDestroyRemoveKeywords: { [keyword]: true } };
    await this.client.call([
      [
        "Email/set",
        {
          accountId,
          ifInState: undefined,
          create: undefined,
          update,
          destroy: undefined,
        },
        "s1",
      ],
    ]);
  }

  async move(engineAccountId: EngineAccountId, messageIds: EngineMessageId[], toMailbox: string): Promise<void> {
    const { accountId } = await this.accountIdOf(engineAccountId);
    const targetId = await this.mailboxIdByName(engineAccountId, toMailbox);
    if (!targetId) throw new Error(`mailbox "${toMailbox}" not found`);
    const update: Record<string, unknown> = {};
    for (const id of messageIds) {
      update[id] = { mailboxIds: { [targetId]: true }, onDestroyRemoveKeywords: { $seen: true, $flagged: true } };
    }
    await this.client.call([
      [
        "Email/set",
        {
          accountId,
          update,
          create: undefined,
          destroy: undefined,
          ifInState: undefined,
        },
        "s1",
      ],
    ]);
  }

  private async createDraftOrSent(
    engineAccountId: EngineAccountId,
    input: SendDraftInput,
    mailboxRole: "drafts" | "sent",
  ): Promise<SendResult> {
    const { accountId } = await this.accountIdOf(engineAccountId);
    const mailboxId = await this.mailboxIdByName(engineAccountId, mailboxRole);
    if (!mailboxId) throw new Error(`mailbox "${mailboxRole}" not found`);

    const attachments: AttachmentMeta[] = [];
    let uploaded: { blobId: string; name: string; type: string }[] = [];
    if (mailboxRole === "sent" && input.attachments?.length) {
      uploaded = await this.uploadAttachments(engineAccountId, input.attachments, attachments);
    }

    const bodyValues: Record<string, unknown> = {
      ...(input.textBody ? { body: { value: input.textBody } } : {}),
      ...(input.htmlBody ? { htmlBody: { value: input.htmlBody } } : {}),
    };
    const body = input.textBody ? [{ partId: "body", type: "text/plain", charset: "utf-8", size: input.textBody.length }] : null;
    const html = input.htmlBody
      ? [{ partId: "htmlBody", type: "text/html", charset: "utf-8", size: input.htmlBody.length }]
      : null;

    const create: Record<string, unknown> = {
      mailboxIds: { [mailboxId]: true },
      ...(mailboxRole === "sent" ? { keywords: { $seen: true } } : {}),
      from: [{ email: input.from }],
      to: input.to.map((email) => ({ email })),
      cc: (input.cc ?? []).map((email) => ({ email })),
      bcc: (input.bcc ?? []).map((email) => ({ email })),
      ...(input.replyTo ? { replyTo: [{ email: input.replyTo }] } : {}),
      subject: input.subject ?? "",
      ...(input.messageId ? { messageId: input.messageId, header: { "Message-ID": [input.messageId] } } : {}),
      ...(input.inReplyTo ? { inReplyTo: input.inReplyTo, header: { "In-Reply-To": [input.inReplyTo] } } : {}),
      ...(input.references ? { references: input.references, header: { "References": [input.references] } } : {}),
      bodyValues,
      ...(body ? { textBody: body } : {}),
      ...(html ? { htmlBody: html } : {}),
      ...(uploaded.length ? { attachments: uploaded } : {}),
    };

    const responses = await this.client.call([
      [
        "Email/set",
        {
          accountId,
          create: { "c1": create },
          update: undefined,
          destroy: undefined,
          ifInState: undefined,
        },
        "s1",
      ],
    ]);
    const created = (responses[0]![1].created ?? {}) as Record<string, { id: string; threadId?: string }>;
    const result = created["c1"];
    if (!result) {
      const notCreated = (responses[0]![1].notCreated as Record<string, unknown>) ?? {};
      const problem = notCreated["c1"] as { type?: string; description?: string } | undefined;
      throw new Error(`mailbox "${mailboxRole}" persistence failed: ${problem?.description ?? "unknown"}`);
    }
    return { engineMessageId: result.id, threadId: result.threadId ?? result.id, attachments };
  }

  private async uploadAttachments(
    engineAccountId: string,
    attachments: NonNullable<SendDraftInput["attachments"]>,
    out: AttachmentMeta[],
  ): Promise<{ blobId: string; name: string; type: string }[]> {
    const { session, accountId } = await this.accountIdOf(engineAccountId);
    const uploaded: { blobId: string; name: string; type: string }[] = [];
    for (const a of attachments) {
      if (!a.content) {
        throw new Error(`attachment "${a.filename}" is missing base64 content`);
      }
      const url = renderTemplate(session.uploadUrl, { accountId });
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": a.contentType,
          Authorization: this.client.authHeader(),
        },
        body: Buffer.from(a.content, "base64"),
      });
      if (!res.ok) {
        throw new Error(`attachment upload failed: HTTP ${res.status} ${res.statusText}`);
      }
      const payload = (await res.json()) as { blobId?: string; size?: number; type?: string };
      if (!payload.blobId) throw new Error("attachment upload returned no blobId");
      out.push({
        engineId: payload.blobId,
        filename: a.filename,
        contentType: a.contentType,
        size: payload.size ?? a.size,
        inline: a.contentDisposition === "inline",
      });
      uploaded.push({ blobId: payload.blobId, name: a.filename, type: a.contentType });
    }
    return uploaded;
  }

  async saveDraft(engineAccountId: EngineAccountId, input: SendDraftInput): Promise<EngineMessageId> {
    const result = await this.createDraftOrSent(engineAccountId, input, "drafts");
    return result.engineMessageId;
  }

  async saveSent(engineAccountId: EngineAccountId, input: SendDraftInput): Promise<SendResult> {
    return this.createDraftOrSent(engineAccountId, input, "sent");
  }

  async findMessageByRfcMessageId(
    engineAccountId: EngineAccountId,
    messageId: string,
  ): Promise<{ engineMessageId: EngineMessageId; engineThreadId: EngineThreadId } | null> {
    const { accountId } = await this.accountIdOf(engineAccountId);
    const responses = await this.client.call([
      [
        "Email/query",
        {
          accountId,
          filter: { header: { "Message-ID": [messageId] } },
          sort: [{ property: "receivedAt", isAscending: true }],
          limit: 1,
          position: 0,
          calculateTotal: undefined,
        },
        "q1",
      ],
      [
        "Email/get",
        {
          accountId,
          "#ids": { resultOf: "q1", name: "Email/query", path: "/ids" },
          properties: ["id", "threadId"],
        },
        "g1",
      ],
    ]);
    const payload = responses[1]![1] as unknown as { list?: { id: string; threadId: string }[] };
    const hit = payload.list?.[0];
    return hit ? { engineMessageId: hit.id, engineThreadId: hit.threadId } : null;
  }

  async search(engineAccountId: EngineAccountId, q: string, mailbox?: string): Promise<MessageSummary[]> {
    const filter: Record<string, unknown> = { text: q };
    if (mailbox) {
      const id = await this.mailboxIdByName(engineAccountId, mailbox);
      if (id) filter.inMailbox = id;
    }
    const emails = await this.queryEmails(engineAccountId, filter, { position: 0, limit: 50 });
    return this.summarize(engineAccountId, emails);
  }

  async getAttachment(engineAccountId: EngineAccountId, attachmentEngineId: string): Promise<AttachmentBody | null> {
    const { session, accountId } = await this.accountIdOf(engineAccountId);
    const url = renderTemplate(session.blobUrl, {
      accountId,
      blobId: attachmentEngineId,
      type: "application/octet-stream",
      name: "attachment",
    });
    const res = await this.fetchImpl(url, {
      method: "GET",
      headers: { Authorization: this.client.authHeader() },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`attachment download failed: HTTP ${res.status} ${res.statusText}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    return { contentType, content: buffer };
  }

  async status(): Promise<MailEngineStatus> {
    try {
      await this.client.session(true);
      return { name: this.name, ok: true };
    } catch (err) {
      return { name: this.name, ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  private get fetchImpl(): typeof fetch {
    return this.opts.fetchImpl ?? fetch;
  }
}
