import { randomUUID } from "node:crypto";
import { JmapClient, JmapError, type JmapMethodCall, type JmapSession } from "./jmap.js";
import type {
  AttachmentBody,
  AttachmentMeta,
  EngineAddressBook,
  EngineAccountId,
  EngineContact,
  EngineContactInput,
  EngineCalendar,
  EngineCalendarEvent,
  EngineMessageId,
  EngineThreadId,
  FullMessage,
  MailboxName,
  MailboxStats,
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
  sessionTtlMs?: number;
  fetchImpl?: typeof fetch;
  onSlowOperation?: (operation: string, durationMs: number) => void;
  onSessionEvent?: (event: "start" | "success" | "rejected", status?: number) => void;
}

interface JmapMailbox {
  id: string;
  name: string;
  role?: string | null;
  sortOrder?: number;
  totalEmails?: number;
  unreadEmails?: number;
}

interface JmapEmailAddress {
  email: string;
  name?: string | null;
}

interface JmapAddressBook {
  id: string;
  name: string;
  isDefault?: boolean;
}

interface JmapCalendar {
  id: string;
  name: string;
  color?: string;
  isDefault?: boolean;
  timeZone?: string;
}

interface JmapCalendarEvent {
  id: string;
  calendarIds?: Record<string, boolean>;
  title?: string;
  description?: string;
  start?: string;
  duration?: string;
  timeZone?: string;
  locations?: Record<string, { name?: string; description?: string; uri?: string }>;
  showWithoutTime?: boolean;
}

interface JmapContact {
  id: string;
  addressBookIds?: Record<string, boolean>;
  name?: { full?: string; components?: { kind: string; value: string }[] };
  emails?: Record<string, { address: string; label?: string; pref?: number }>;
  phones?: Record<string, { number: string; label?: string; pref?: number }>;
  organizations?: Record<string, { name?: string }>;
  titles?: Record<string, { name?: string }>;
  onlineServices?: Record<string, { uri?: string }>;
  addresses?: Record<string, { full?: string; components?: { kind: string; value: string }[] }>;
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
  preview?: string;
  from?: JmapEmailAddress[];
  to?: JmapEmailAddress[];
  cc?: JmapEmailAddress[];
  bcc?: JmapEmailAddress[];
  replyTo?: JmapEmailAddress[];
  inReplyTo?: string | string[];
  references?: string | string[];
  messageId?: string | string[];
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
  "bodyValues",
  "attachments",
  "textBody",
  "htmlBody",
  "header:Message-ID",
  "header:In-Reply-To",
  "header:References",
] as const;

const SUMMARY_PROPERTIES = [
  "id",
  "threadId",
  "mailboxIds",
  "keywords",
  "size",
  "receivedAt",
  "sentAt",
  "subject",
  "preview",
  "from",
  "to",
  "cc",
  "hasAttachment",
] as const;

const ROLE_TO_ENGINE: Record<string, Exclude<MailboxName["role"], null>> = {
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

const messageIdsToHeader = (value?: string | string[]): string | undefined => {
  if (Array.isArray(value)) return value.length > 0 ? value.join(" ") : undefined;
  return value;
};

const snippetOf = (email: JmapEmail): string => {
  if (email.preview) return email.preview.replace(/\s+/g, " ").trim().slice(0, 200);
  const partId = email.textBody?.[0]?.partId;
  const value = partId ? email.bodyValues?.[partId]?.value ?? "" : "";
  return value.replace(/\s+/g, " ").trim().slice(0, 200);
};

const renderTemplate = (template: string, vars: Record<string, string>): string =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, v), template);

const presentKeys = (value: Record<string, unknown>): string[] => Object.entries(value).filter(([, item]) => item !== undefined).map(([key]) => key);

const objectValues = <T>(value: Record<string, T> | undefined): T[] => Object.values(value ?? {});

const addDuration = (start: string | undefined, duration: string): string | undefined => {
  if (!start) return undefined;
  const match = duration.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!match) return undefined;
  const milliseconds = ((Number(match[1] ?? 0) * 24 + Number(match[2] ?? 0)) * 60 + Number(match[3] ?? 0)) * 60_000 + Number(match[4] ?? 0) * 1_000;
  const date = new Date(start);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Date(date.getTime() + milliseconds).toISOString();
};

const contactInputToCard = (input: EngineContactInput, addressBookId: string, uid: string): Record<string, unknown> => {
  const card: Record<string, unknown> = {
    "@type": "Card",
    version: "1.0",
    uid,
    addressBookIds: Object.fromEntries((input.addressBookIds ?? [addressBookId]).map((id) => [id, true])),
  };
  const components = [
    input.firstName ? { kind: "given", value: input.firstName } : undefined,
    input.middleName ? { kind: "given2", value: input.middleName } : undefined,
    input.lastName ? { kind: "surname", value: input.lastName } : undefined,
  ].filter((item): item is { kind: string; value: string } => Boolean(item));
  if (components.length || input.displayName) card.name = { ...(input.displayName ? { full: input.displayName } : {}), ...(components.length ? { components, isOrdered: true } : {}) };
  if (input.organization) card.organizations = { o1: { name: input.organization } };
  if (input.jobTitle) card.titles = { t1: { kind: "title", name: input.jobTitle } };
  if (input.website) card.onlineServices = { s1: { uri: input.website } };
  if (input.address || input.city || input.state || input.postalCode || input.country) {
    const addressComponents = [
      input.city ? { kind: "locality", value: input.city } : undefined,
      input.state ? { kind: "region", value: input.state } : undefined,
      input.postalCode ? { kind: "postcode", value: input.postalCode } : undefined,
      input.country ? { kind: "country", value: input.country } : undefined,
    ].filter((item): item is { kind: string; value: string } => Boolean(item));
    card.addresses = { a1: { ...(input.address ? { full: input.address } : {}), ...(addressComponents.length ? { components: addressComponents } : {}) } };
  }
  if (input.emails.length) card.emails = Object.fromEntries(input.emails.map((item, index) => [`e${index + 1}`, { address: item.value, ...(item.label ? { label: item.label } : {}), ...(item.isPrimary ? { pref: 1 } : {}) }]));
  if (input.phones.length) card.phones = Object.fromEntries(input.phones.map((item, index) => [`p${index + 1}`, { number: item.value, ...(item.label ? { label: item.label } : {}), ...(item.isPrimary ? { pref: 1 } : {}) }]));
  return card;
};

const cardToContact = (card: JmapContact): EngineContact => {
  const components = card.name?.components ?? [];
  const given = components.find((item) => item.kind === "given")?.value;
  const middle = components.find((item) => item.kind === "given2")?.value;
  const surname = components.find((item) => item.kind === "surname")?.value;
  const address = objectValues(card.addresses)[0];
  const addressComponents = address?.components ?? [];
  const first = (kind: string) => addressComponents.find((item) => item.kind === kind)?.value;
  const emails = objectValues(card.emails).map((item) => ({ value: item.address, ...(item.label ? { label: item.label } : {}), ...(item.pref === 1 ? { isPrimary: true } : {}) }));
  const phones = objectValues(card.phones).map((item) => ({ value: item.number, ...(item.label ? { label: item.label } : {}), ...(item.pref === 1 ? { isPrimary: true } : {}) }));
  if (emails.length && !emails.some((item) => item.isPrimary)) emails[0]!.isPrimary = true;
  if (phones.length && !phones.some((item) => item.isPrimary)) phones[0]!.isPrimary = true;
  return {
    engineId: card.id,
    addressBookIds: Object.entries(card.addressBookIds ?? {}).filter(([, included]) => included).map(([id]) => id),
    ...(given ? { firstName: given } : {}),
    ...(middle ? { middleName: middle } : {}),
    ...(surname ? { lastName: surname } : {}),
    ...(card.name?.full ? { displayName: card.name.full } : {}),
    ...(!card.name?.full && (given || middle || surname) ? { displayName: [given, middle, surname].filter(Boolean).join(" ") } : {}),
    ...(objectValues(card.organizations)[0]?.name ? { organization: objectValues(card.organizations)[0]!.name } : {}),
    ...(objectValues(card.titles)[0]?.name ? { jobTitle: objectValues(card.titles)[0]!.name } : {}),
    ...(objectValues(card.onlineServices)[0]?.uri ? { website: objectValues(card.onlineServices)[0]!.uri } : {}),
    ...(address?.full ? { address: address.full } : {}),
    ...(first("locality") ? { city: first("locality") } : {}),
    ...(first("region") ? { state: first("region") } : {}),
    ...(first("postcode") ? { postalCode: first("postcode") } : {}),
    ...(first("country") ? { country: first("country") } : {}),
    emails,
    phones,
  };
};

const summarizeParts = (value: unknown) => Array.isArray(value)
  ? value.map((part) => {
      if (!part || typeof part !== "object") return { type: typeof part };
      const item = part as Record<string, unknown>;
      return { keys: presentKeys(item), partId: item.partId, type: item.type };
    })
  : undefined;

const summarizeEmail = (value: Record<string, unknown>) => ({
  keys: presentKeys(value),
  mailboxIds: value.mailboxIds && typeof value.mailboxIds === "object" ? Object.keys(value.mailboxIds as object) : undefined,
  recipientCounts: {
    to: Array.isArray(value.to) ? value.to.length : 0,
    cc: Array.isArray(value.cc) ? value.cc.length : 0,
    bcc: Array.isArray(value.bcc) ? value.bcc.length : 0,
  },
  bodyValueIds: value.bodyValues && typeof value.bodyValues === "object" ? Object.keys(value.bodyValues as object) : undefined,
  textBody: summarizeParts(value.textBody),
  htmlBody: summarizeParts(value.htmlBody),
  hasMessageId: value.messageId !== undefined,
  hasInReplyTo: value.inReplyTo !== undefined,
  hasReferences: value.references !== undefined,
});

const summarizeEmailSet = (args: Record<string, unknown>) => ({
  keys: presentKeys(args),
  create: args.create && typeof args.create === "object"
    ? Object.fromEntries(Object.entries(args.create as Record<string, unknown>).map(([id, value]) => [id, value && typeof value === "object" ? summarizeEmail(value as Record<string, unknown>) : { type: typeof value }]))
    : undefined,
  update: args.update && typeof args.update === "object"
    ? Object.fromEntries(Object.entries(args.update as Record<string, unknown>).map(([id, value]) => [id, value && typeof value === "object" ? { keys: presentKeys(value as Record<string, unknown>) } : { type: typeof value }]))
    : undefined,
  destroy: Array.isArray(args.destroy) ? args.destroy.length : undefined,
});

const summarizeEmailSetResponse = (response: [string, Record<string, unknown>, string | null]) => {
  const [name, payload, callId] = response;
  return {
    responseName: name,
    callId,
    errorType: typeof payload.type === "string" ? payload.type : undefined,
    errorDescription: typeof payload.description === "string" ? payload.description : undefined,
    payloadKeys: Object.keys(payload),
    notCreated: payload.notCreated,
    notUpdated: payload.notUpdated,
  };
};

export class StalwartEngine implements MailEngine {
  readonly name = "stalwart";
  private readonly client: JmapClient;
  private readonly mailboxes = new Map<EngineAccountId, MailboxName[]>();
  private readonly mailboxStats = new Map<EngineAccountId, MailboxStats[]>();
  private readonly mailboxLoads = new Map<EngineAccountId, Promise<MailboxName[]>>();

  constructor(private readonly opts: StalwartOptions) {
    this.client = new JmapClient({
      baseUrl: opts.jmapUrl,
      ...(opts.accessToken ? { token: opts.accessToken } : {}),
      sessionTtlMs: opts.sessionTtlMs ?? 60_000,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      ...(opts.onSlowOperation ? { onSlowOperation: opts.onSlowOperation } : {}),
      ...(opts.onSessionEvent ? { onSessionEvent: opts.onSessionEvent } : {}),
    });
  }

  private async accountIdOf(engineAccountId: EngineAccountId): Promise<{ session: JmapSession; accountId: string }> {
    const session = await this.client.session();
    return { session, accountId: this.client.resolveAccountId(session, this.opts.resolveAccount ? await this.opts.resolveAccount(engineAccountId) : engineAccountId) };
  }

  async listMailboxes(engineAccountId: EngineAccountId): Promise<MailboxName[]> {
    const cached = this.mailboxes.get(engineAccountId);
    if (cached) return cached;
    const loading = this.mailboxLoads.get(engineAccountId);
    if (loading) return loading;
    const request = this.loadMailboxes(engineAccountId);
    this.mailboxLoads.set(engineAccountId, request);
    try {
      return await request;
    } finally {
      this.mailboxLoads.delete(engineAccountId);
    }
  }

  private async loadMailboxes(engineAccountId: EngineAccountId): Promise<MailboxName[]> {
    const session = await this.client.session();
    const accountId = this.client.resolveAccountId(session, this.opts.resolveAccount ? await this.opts.resolveAccount(engineAccountId) : engineAccountId);
    const responses = await this.client.call([
      [
        "Mailbox/get",
        {
          accountId,
          ids: null,
          properties: ["id", "name", "role", "sortOrder", "totalEmails", "unreadEmails"],
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
        role: m.role ? (ROLE_TO_ENGINE[m.role.toLowerCase()] ?? null) : null,
        engineName: m.name,
      }));
    const stats = list.flatMap<MailboxStats>((m) => {
      const role = m.role ? ROLE_TO_ENGINE[m.role.toLowerCase()] : undefined;
      return role ? [{ role, total: m.totalEmails ?? 0, unread: m.unreadEmails ?? 0 }] : [];
    });
    this.mailboxes.set(engineAccountId, mailboxes);
    this.mailboxStats.set(engineAccountId, stats);
    return mailboxes;
  }

  async listMailboxStats(engineAccountId: EngineAccountId): Promise<MailboxStats[]> {
    await this.ensureMailboxes(engineAccountId);
    return this.mailboxStats.get(engineAccountId) ?? [];
  }

  private async ensureMailboxes(engineAccountId: EngineAccountId): Promise<MailboxName[]> {
    const cached = this.mailboxes.get(engineAccountId);
    if (cached) return cached;
    return this.listMailboxes(engineAccountId);
  }

  private async mailboxIdByName(engineAccountId: EngineAccountId, roleOrName: string): Promise<string | null> {
    const mailboxes = await this.ensureMailboxes(engineAccountId);
    const needle = roleOrName.toLowerCase();
    const match = mailboxes.find((m) => m.engineId === roleOrName)
      ?? mailboxes.find((m) => m.role === needle)
      ?? mailboxes.find((m) => m.engineName.toLowerCase() === needle);
    return match?.engineId ?? null;
  }

  private async mailboxNameById(engineAccountId: EngineAccountId, id: string): Promise<string> {
    const mailboxes = await this.ensureMailboxes(engineAccountId);
    return mailboxes.find((m) => m.engineId === id)?.engineName ?? id;
  }

  private async roleToEngineName(engineAccountId: EngineAccountId, role: Exclude<MailboxName["role"], null>): Promise<string> {
    const mailboxes = await this.ensureMailboxes(engineAccountId);
    const found = mailboxes.find((m) => m.role === role);
    if (found) return found.engineName;
    const fallback = mailboxes[0]?.engineName;
    if (fallback) return fallback;
    return role;
  }

  private async emailSet(
    accountId: string,
    args: Record<string, unknown>,
    operation: string,
    context: Record<string, unknown>,
  ): Promise<[string, Record<string, unknown>, string | null][]> {
    const method: JmapMethodCall = ["Email/set", args, "s1"];
    console.info("[stalwart:Email/set] request", JSON.stringify({ operation, accountId, ...context, request: summarizeEmailSet(args) }));
    try {
      const responses = await this.client.call([method]);
      console.info("[stalwart:Email/set] response", JSON.stringify({ operation, accountId, ...context, response: summarizeEmailSetResponse(responses[0]!) }));
      return responses;
    } catch (error) {
      const jmap = error instanceof JmapError
        ? { errorType: error.type, errorDescription: error.message, callId: error.callId, response: error.response }
        : { errorDescription: error instanceof Error ? error.message : String(error) };
      console.error("[stalwart:Email/set] failed", JSON.stringify({ operation, accountId, ...context, jmap }));
      throw error;
    }
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
          properties: SUMMARY_PROPERTIES as unknown as string[],
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
      ["Message-ID", email["header:Message-ID"] ?? messageIdsToHeader(email.messageId)],
      ["In-Reply-To", email["header:In-Reply-To"] ?? messageIdsToHeader(email.inReplyTo)],
      ["References", email["header:References"] ?? messageIdsToHeader(email.references)],
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
          properties: SUMMARY_PROPERTIES as unknown as string[],
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
    for (const id of messageIds) {
      update[id] = Object.fromEntries(Object.entries(keywords).map(([name, value]) => [`/keywords/${name}`, value ? true : null]));
    }
    await this.emailSet(accountId, {
      accountId,
      ifInState: undefined,
      create: undefined,
      update,
      destroy: undefined,
    }, "updateKeywords", { keyword });
  }

  async move(engineAccountId: EngineAccountId, messageIds: EngineMessageId[], toMailbox: string): Promise<void> {
    const { accountId } = await this.accountIdOf(engineAccountId);
    const targetId = await this.mailboxIdByName(engineAccountId, toMailbox);
    if (!targetId) throw new Error(`mailbox "${toMailbox}" not found`);
    const update: Record<string, unknown> = {};
    for (const id of messageIds) {
      update[id] = {
        mailboxIds: { [targetId]: true },
        "/keywords/$seen": null,
        "/keywords/$flagged": null,
      };
    }
    await this.emailSet(accountId, {
      accountId,
      update,
      create: undefined,
      destroy: undefined,
      ifInState: undefined,
    }, "move", { targetMailbox: toMailbox, targetMailboxId: targetId });
  }

  async destroy(engineAccountId: EngineAccountId, messageIds: EngineMessageId[]): Promise<void> {
    const { accountId } = await this.accountIdOf(engineAccountId);
    await this.emailSet(accountId, {
      accountId,
      update: undefined,
      create: undefined,
      destroy: messageIds,
      ifInState: undefined,
    }, "destroy", { messageCount: messageIds.length });
  }

  private async createDraftOrSent(
    engineAccountId: EngineAccountId,
    input: SendDraftInput,
    mailboxRole: "drafts" | "sent",
    operation = mailboxRole === "drafts" ? "saveDraft" : "saveSent",
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
    const body = input.textBody ? [{ partId: "body", type: "text/plain" }] : null;
    const html = input.htmlBody
      ? [{ partId: "htmlBody", type: "text/html" }]
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
      ...(input.messageId ? { messageId: [input.messageId] } : {}),
      ...(input.inReplyTo ? { inReplyTo: [input.inReplyTo] } : {}),
      ...(input.references ? { references: [input.references] } : {}),
      bodyValues,
      ...(body ? { textBody: body } : {}),
      ...(html ? { htmlBody: html } : {}),
      ...(uploaded.length ? { attachments: uploaded } : {}),
    };

    const responses = await this.emailSet(accountId, {
      accountId,
      create: { "c1": create },
      update: undefined,
      destroy: undefined,
      ifInState: undefined,
    }, operation, { mailboxRole, mailboxId });
    const created = (responses[0]![1].created ?? {}) as Record<string, { id: string; threadId?: string }>;
    const result = created["c1"];
    if (!result) {
      const notCreated = (responses[0]![1].notCreated as Record<string, unknown>) ?? {};
      const problem = notCreated["c1"] as { type?: string; description?: string } | undefined;
      throw new JmapError(
        `mailbox "${mailboxRole}" persistence failed: ${problem?.description ?? "unknown"}`,
        problem?.type ?? "not_created",
        "s1",
        problem ?? notCreated,
      );
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

  async updateDraft(engineAccountId: EngineAccountId, messageId: EngineMessageId, input: SendDraftInput): Promise<EngineMessageId> {
    const replacement = await this.createDraftOrSent(engineAccountId, input, "drafts", "updateDraft");
    try {
      await this.move(engineAccountId, [messageId], "Trash");
    } catch (error) {
      throw new Error(`draft replacement cleanup failed for ${messageId}`, { cause: error });
    }
    return replacement.engineMessageId;
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

  async listAddressBooks(engineAccountId: EngineAccountId): Promise<EngineAddressBook[]> {
    const { accountId } = await this.accountIdOf(engineAccountId);
    const responses = await this.client.call([["AddressBook/get", { accountId, ids: null }, "ab1"]]);
    const payload = responses[0]![1] as { list?: JmapAddressBook[] };
    return (payload.list ?? []).map((book) => ({ engineId: book.id, name: book.name, isDefault: book.isDefault === true }));
  }

  async listCalendars(engineAccountId: EngineAccountId): Promise<EngineCalendar[]> {
    const { accountId } = await this.accountIdOf(engineAccountId);
    const responses = await this.client.call([["Calendar/get", { accountId, ids: null, properties: ["id", "name", "color", "isDefault", "timeZone"] }, "cal1"]]);
    const payload = responses[0]![1] as { list?: JmapCalendar[] };
    return (payload.list ?? []).map((calendar) => ({
      engineId: calendar.id,
      name: calendar.name,
      ...(calendar.color ? { color: calendar.color } : {}),
      isDefault: calendar.isDefault === true,
      ...(calendar.timeZone ? { timeZone: calendar.timeZone } : {}),
    }));
  }

  async listCalendarEvents(engineAccountId: EngineAccountId, after: string, before: string): Promise<EngineCalendarEvent[]> {
    const { accountId } = await this.accountIdOf(engineAccountId);
    const responses = await this.client.call([
      ["CalendarEvent/query", { accountId, filter: { after, before }, position: 0, limit: 200, sort: [{ property: "start", isAscending: true }] }, "ceq1"],
      ["CalendarEvent/get", { accountId, "#ids": { resultOf: "ceq1", name: "CalendarEvent/query", path: "/ids" }, properties: ["id", "calendarIds", "title", "description", "start", "duration", "locations", "showWithoutTime"] }, "ceg1"],
    ]);
    const payload = responses[1]![1] as { list?: JmapCalendarEvent[] };
    return (payload.list ?? []).map((event) => ({
      engineId: event.id,
      calendarIds: Object.entries(event.calendarIds ?? {}).filter(([, included]) => included).map(([id]) => id),
      title: event.title ?? "Untitled event",
      ...(event.description ? { description: event.description } : {}),
      start: event.start ?? "",
      ...(event.duration ? { end: addDuration(event.start, event.duration) } : {}),
      ...(Object.values(event.locations ?? {})[0]?.name ? { location: Object.values(event.locations ?? {})[0]!.name } : {}),
      allDay: event.showWithoutTime === true,
    }));
  }

  async listContacts(engineAccountId: EngineAccountId): Promise<EngineContact[]> {
    const { accountId } = await this.accountIdOf(engineAccountId);
    const responses = await this.client.call([["ContactCard/get", { accountId, ids: null }, "cc1"]]);
    const payload = responses[0]![1] as { list?: JmapContact[] };
    return (payload.list ?? []).map(cardToContact);
  }

  async getContact(engineAccountId: EngineAccountId, contactId: string): Promise<EngineContact | null> {
    const { accountId } = await this.accountIdOf(engineAccountId);
    const responses = await this.client.call([["ContactCard/get", { accountId, ids: [contactId] }, "cc1"]]);
    const payload = responses[0]![1] as { list?: JmapContact[] };
    const card = payload.list?.[0];
    return card ? cardToContact(card) : null;
  }

  async createContact(engineAccountId: EngineAccountId, input: EngineContactInput): Promise<EngineContact> {
    const { accountId } = await this.accountIdOf(engineAccountId);
    const addressBooks = await this.listAddressBooks(engineAccountId);
    const addressBookId = input.addressBookIds?.[0] ?? addressBooks.find((book) => book.isDefault)?.engineId ?? addressBooks[0]?.engineId;
    if (!addressBookId) throw new Error("Stalwart has no writable address book");
    const clientId = "c1";
    const responses = await this.client.call([["ContactCard/set", { accountId, create: { [clientId]: contactInputToCard(input, addressBookId, randomUUID()) } }, "cs1"]]);
    const payload = responses[0]![1] as { created?: Record<string, { id?: string }>; notCreated?: Record<string, { description?: string }> };
    const created = payload.created?.[clientId];
    if (!created?.id) throw new Error(payload.notCreated?.[clientId]?.description ?? "Stalwart did not return a contact ID");
    const contact = await this.getContact(engineAccountId, created.id);
    if (!contact) throw new Error("Stalwart contact disappeared after creation");
    return contact;
  }

  async updateContact(engineAccountId: EngineAccountId, contactId: string, input: EngineContactInput): Promise<EngineContact> {
    const current = await this.getContact(engineAccountId, contactId);
    if (!current) throw new Error("contact not found");
    const card = contactInputToCard(input, current.addressBookIds[0] ?? "", "");
    delete card.uid;
    const { accountId } = await this.accountIdOf(engineAccountId);
    const update = Object.fromEntries(["name", "organizations", "titles", "onlineServices", "addresses", "emails", "phones"].map((property) => [`/${property}`, card[property] ?? null]));
    update["/addressBookIds"] = Object.fromEntries((input.addressBookIds ?? current.addressBookIds).map((id) => [id, true]));
    const responses = await this.client.call([["ContactCard/set", { accountId, update: { [contactId]: update } }, "cs1"]]);
    const payload = responses[0]![1] as { notUpdated?: Record<string, { description?: string }> };
    if (payload.notUpdated?.[contactId]) throw new Error(payload.notUpdated[contactId].description ?? "Stalwart contact update failed");
    const updated = await this.getContact(engineAccountId, contactId);
    if (!updated) throw new Error("Stalwart contact disappeared after update");
    return updated;
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
