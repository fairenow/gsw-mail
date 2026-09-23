export interface Account {
  id: string;
  address: string;
  displayName: string | null;
  status: string;
  role: "owner" | "delegate" | "read_only";
  permissions: ("read" | "send" | "manage")[];
}

export interface MessageSummary {
  engineId: string;
  threadId: string;
  subject: string;
  snippet?: string;
  date: string;
  from?: { name?: string; email: string };
  to?: { name?: string; email: string }[];
  cc?: { name?: string; email: string }[];
  read: boolean;
  flagged: boolean;
  hasAttachments: boolean;
  mailbox: string;
}

export interface MessageAttachment {
  engineId: string;
  filename: string;
  contentType: string;
  size: number;
  inline: boolean;
}

export interface ComposeAttachment {
  filename: string;
  contentType: string;
  size: number;
  content: string;
  contentDisposition?: "attachment" | "inline";
  contentId?: string;
}

export interface FullMessage extends MessageSummary {
  textBody?: string;
  htmlBody?: string;
  attachments?: MessageAttachment[];
  headers?: Record<string, string>;
}

export interface Contact {
  id: string;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  organization?: string | null;
  jobTitle?: string | null;
  website?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  notes?: string | null;
  stalwartContactId?: string | null;
  stalwartAddressBookId?: string | null;
  addressBookIds: string[];
  source: string;
  sourceFile?: string | null;
  lastContactedAt?: string | null;
  firstContactedAt?: string | null;
  timesEmailed: number;
  emails: { email: string; normalizedEmail: string; label?: string | null; isPrimary: boolean }[];
  phones: { phone: string; label?: string | null; isPrimary: boolean }[];
  tags: string[];
  customFields: Record<string, string | number | boolean | null>;
}

export interface ContactListResponse {
  contacts: Contact[];
  total: number;
  limit: number;
  offset: number;
}

export interface CalendarSummary {
  engineId: string;
  name: string;
  color?: string;
  isDefault: boolean;
  timeZone?: string;
}

export interface CalendarEvent {
  engineId: string;
  calendarIds: string[];
  title: string;
  description?: string;
  start: string;
  end?: string;
  location?: string;
  meetingLink?: string;
  attendees: string[];
  allDay: boolean;
}

export interface ProductSettings {
  general: Record<string, unknown>;
  compose: Record<string, unknown>;
  contacts: Record<string, unknown>;
  signature: { id: string | null; signatureHtml: string; signatureText: string; enabled: boolean; onNew: boolean; onReply: boolean; onForward: boolean; position: "beforeQuotedText" | "afterQuotedText" };
}

export interface SendResult {
  sendId: string;
  messageId: string | null;
  threadId: string | null;
  status: string;
  undoUntil: string | null;
  idempotentReplay?: boolean;
}

export interface SetupState {
  workspace: { id: string; name: string; role: "owner" | "admin" | "member" };
  domain: { id: string; name: string; status: string } | null;
  mailbox: { id: string; address: string } | null;
  currentStep: "email_verified" | "workspace_created" | "domain_added" | "domain_verified" | "first_mailbox_created" | "complete";
  onboardingComplete: boolean;
  migratedFromExisting: boolean;
}

interface AccountsResponse { accounts: Account[]; }
interface MessagesResponse { messages: MessageSummary[]; }

export interface MailboxFolderStats { total: number; unread: number; }
interface MailboxStatsResponse { folders: Record<string, MailboxFolderStats>; }

export interface DraftInput {
  accountId: string;
  to?: string[];
  cc?: string[];
  subject?: string;
  textBody?: string;
  htmlBody?: string;
  bcc?: string[];
  inReplyTo?: string;
  references?: string;
  mode?: "new" | "reply" | "replyAll" | "forward";
  templateKey?: string;
}

const headers = (jsonBody = false): Record<string, string> => ({ ...(jsonBody ? { "content-type": "application/json" } : {}) });

const json = async <T,>(res: Response): Promise<T> => {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const details = body as { message?: string; error?: string };
    if (res.status === 401 && details.error !== "mail_identity_rejected") window.dispatchEvent(new Event("gsw-account-error"));
    if (details.error === "mail_identity_rejected") throw new Error("Your mailbox connection needs attention. Retry to reconnect.");
    throw new Error(details.message ?? details.error ?? `request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
};

const get = <T,>(url: string) => fetch(url, { headers: headers(), credentials: "include" }).then((res) => json<T>(res));

type CachedRead = { value: unknown; freshUntil: number; staleUntil: number };
const readCache = new Map<string, CachedRead>();
const inflightReads = new Map<string, Promise<unknown>>();
let activeMailAccountId: string | null = null;

const fetchAndCache = <T,>(url: string, freshMs: number, staleMs: number): Promise<T> => {
  const existing = inflightReads.get(url) as Promise<T> | undefined;
  if (existing) return existing;
  const request = get<T>(url)
    .then((value) => {
      const now = Date.now();
      readCache.set(url, { value, freshUntil: now + freshMs, staleUntil: now + staleMs });
      return value;
    })
    .finally(() => inflightReads.delete(url));
  inflightReads.set(url, request as Promise<unknown>);
  return request;
};

const cachedGet = <T,>(url: string, freshMs: number, staleMs = freshMs * 6): Promise<T> => {
  const cached = readCache.get(url);
  const now = Date.now();
  if (cached && cached.freshUntil > now) return Promise.resolve(cached.value as T);
  if (cached && cached.staleUntil > now) {
    void fetchAndCache<T>(url, freshMs, staleMs).catch(() => undefined);
    return Promise.resolve(cached.value as T);
  }
  if (cached) readCache.delete(url);
  return fetchAndCache<T>(url, freshMs, staleMs);
};

const messageListPrefix = (accountId: string) => `/mail/messages?accountId=${accountId}&`;
const messageDetailKey = (accountId: string, engineId: string) => `/mail/messages/${engineId}?accountId=${accountId}`;

const mutateCachedMessages = (accountId: string, engineId: string, patch: Partial<MessageSummary>) => {
  for (const [key, cached] of readCache) {
    if (!key.startsWith(messageListPrefix(accountId))) continue;
    const response = cached.value as MessagesResponse;
    if (!response?.messages) continue;
    readCache.set(key, { ...cached, value: { ...response, messages: response.messages.map((message) => message.engineId === engineId ? { ...message, ...patch } : message) } });
  }
  const detailKey = messageDetailKey(accountId, engineId);
  const detail = readCache.get(detailKey);
  if (detail) readCache.set(detailKey, { ...detail, value: { ...(detail.value as FullMessage), ...patch } });
};

const removeCachedMessage = (accountId: string, engineId: string) => {
  for (const [key, cached] of readCache) {
    if (!key.startsWith(messageListPrefix(accountId))) continue;
    const response = cached.value as MessagesResponse;
    if (!response?.messages) continue;
    readCache.set(key, { ...cached, value: { ...response, messages: response.messages.filter((message) => message.engineId !== engineId) } });
  }
  readCache.delete(messageDetailKey(accountId, engineId));
  readCache.delete(`/mail/mailboxes/stats?accountId=${encodeURIComponent(accountId)}`);
};

const clearAccountMailCache = (accountId: string) => {
  for (const key of readCache.keys()) {
    if (key.includes(`accountId=${accountId}`) || key.includes(`accountId=${encodeURIComponent(accountId)}`)) readCache.delete(key);
  }
};

const request = async (url: string, init: RequestInit, timeoutMs?: number): Promise<Response> => {
  const controller = timeoutMs ? new AbortController() : undefined;
  const timeout = timeoutMs ? window.setTimeout(() => controller?.abort(), timeoutMs) : undefined;
  try {
    return await fetch(url, { ...init, credentials: "include", ...(controller ? { signal: controller.signal } : {}) });
  } catch (error) {
    if (controller?.signal.aborted) throw new Error(`request timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
};

const post = async <T,>(url: string, body?: unknown, timeoutMs?: number): Promise<T> =>
  request(url, { method: "POST", headers: headers(!!body), body: body ? JSON.stringify(body) : undefined }, timeoutMs).then((res) => json<T>(res));

const patch = async <T,>(url: string, body: unknown, timeoutMs?: number): Promise<T> =>
  request(url, { method: "PATCH", headers: headers(true), body: JSON.stringify(body) }, timeoutMs).then((res) => json<T>(res));

const interactiveTimeout = 20_000;

export type BulkMailAction = "archive" | "trash" | "restore" | "destroy" | "read" | "unread" | "star" | "unstar";

export const api = {
  setup: () => get<SetupState>("/api/setup"),
  updateWorkspace: (name: string) => patch<Pick<SetupState, "workspace" | "currentStep">>("/api/setup/workspace", { name }),
  addSetupDomain: (domain: string) => post<Pick<SetupState, "domain" | "currentStep">>("/api/setup/domain", { domain }),
  accounts: () => cachedGet<AccountsResponse>("/mail/accounts", 15_000, 120_000).then((r) => r.accounts),
  messages: (accountId: string, mailbox: string, limit = 50, offset = 0) => { activeMailAccountId = accountId; return cachedGet<MessagesResponse>(`/mail/messages?accountId=${accountId}&mailbox=${mailbox}&limit=${limit}&offset=${offset}`, 4_000, 30_000).then((r) => r.messages); },
  mailboxStats: (accountId: string) => { activeMailAccountId = accountId; return cachedGet<MailboxStatsResponse>(`/mail/mailboxes/stats?accountId=${encodeURIComponent(accountId)}`, 5_000, 30_000).then((r) => r.folders); },
  message: (accountId: string, engineId: string) => { activeMailAccountId = accountId; return cachedGet<FullMessage>(messageDetailKey(accountId, engineId), 30_000, 5 * 60_000); },
  prefetchActiveMessage: (engineId: string) => { if (!activeMailAccountId) return; void cachedGet<FullMessage>(messageDetailKey(activeMailAccountId, engineId), 30_000, 5 * 60_000).catch(() => undefined); },
  read: async (accountId: string, engineId: string, seen: boolean) => { const result = await post(`/mail/messages/${engineId}/read`, { accountId, seen }); mutateCachedMessages(accountId, engineId, { read: seen }); readCache.delete(`/mail/mailboxes/stats?accountId=${encodeURIComponent(accountId)}`); return result; },
  flag: async (accountId: string, engineId: string, flagged: boolean) => { const result = await post(`/mail/messages/${engineId}/flag`, { accountId, flagged }); mutateCachedMessages(accountId, engineId, { flagged }); return result; },
  bulk: async (accountId: string, ids: string[], action: BulkMailAction) => { const result = await post<{ updated: number; action: BulkMailAction }>("/mail/messages/bulk", { accountId, ids, action }, interactiveTimeout); clearAccountMailCache(accountId); return result; },
  archive: async (accountId: string, engineId: string) => { const result = await post(`/mail/messages/${engineId}/archive`, { accountId }); removeCachedMessage(accountId, engineId); return result; },
  trash: async (accountId: string, engineId: string) => { const result = await post(`/mail/messages/${engineId}/trash`, { accountId }); removeCachedMessage(accountId, engineId); return result; },
  move: async (accountId: string, engineId: string, mailbox: string) => { const result = await post(`/mail/messages/${engineId}/move`, { accountId, mailbox }); removeCachedMessage(accountId, engineId); return result; },
  destroy: async (accountId: string, engineId: string) => { const result = await post(`/mail/messages/${engineId}/destroy`, { accountId }); removeCachedMessage(accountId, engineId); return result; },
  emptyTrash: async (accountId: string) => { const result = await post<{ deleted: number }>("/mail/messages/empty-trash", { accountId }); clearAccountMailCache(accountId); return result; },
  attachmentUrl: (accountId: string, attachment: MessageAttachment) => `/mail/attachments/${encodeURIComponent(attachment.engineId)}?accountId=${encodeURIComponent(accountId)}&filename=${encodeURIComponent(attachment.filename)}`,
  search: (accountId: string, q: string) => get<MessagesResponse>(`/mail/search?accountId=${accountId}&q=${encodeURIComponent(q)}`).then((r) => r.messages),
  send: async (accountId: string, to: string[], body: { cc?: string[]; bcc?: string[]; subject?: string; textBody?: string; htmlBody?: string; inReplyTo?: string; references?: string; mode?: "new" | "reply" | "replyAll" | "forward"; clientRequestId?: string; templateKey?: string; attachments?: ComposeAttachment[] }) => { const result = await post<SendResult>("/mail/send", { accountId, to, ...body }, interactiveTimeout); clearAccountMailCache(accountId); return result; },
  createDraft: async (body: DraftInput) => { const result = await post<{ engineId: string }>("/mail/drafts", body, interactiveTimeout); clearAccountMailCache(body.accountId); return result; },
  updateDraft: async (id: string, body: DraftInput) => { const result = await patch<{ engineId: string }>(`/mail/drafts/${id}`, body, interactiveTimeout).then((value) => value ?? { engineId: id }); clearAccountMailCache(body.accountId); return result; },
  sendDraft: async (id: string, accountId: string, clientRequestId?: string, mode?: "new" | "reply" | "replyAll" | "forward", templateKey?: string, attachments?: ComposeAttachment[]) => { const result = await post<SendResult>(`/mail/drafts/${id}/send`, { accountId, ...(clientRequestId ? { clientRequestId } : {}), ...(mode ? { mode } : {}), ...(templateKey ? { templateKey } : {}), ...(attachments?.length ? { attachments } : {}) }, interactiveTimeout); clearAccountMailCache(accountId); return result; },
  sendStatus: (sendId: string) => get<never>("/mail/sends/" + sendId),
  cancelSend: (sendId: string) => post<{ status: string }>(`/mail/sends/${sendId}/cancel`),
  retrySend: (sendId: string, accountId: string) => post<{ status: string }>(`/mail/sends/${sendId}/retry`, { accountId }),
  settings: () => get<ProductSettings>("/product/settings"),
  updateSettings: (body: { general?: Record<string, unknown>; compose?: Record<string, unknown>; contacts?: Record<string, unknown> }) => patch<ProductSettings>("/product/settings", body),
  saveSignature: (body: ProductSettings["signature"]) => request("/product/signature", { method: "PUT", headers: headers(true), body: JSON.stringify(body) }).then((res) => json<ProductSettings["signature"]>(res)),
  contacts: (q = "") => get<ContactListResponse>(`/product/contacts?q=${encodeURIComponent(q)}`).then((r) => r.contacts),
  contactsPage: (q = "", limit = 100, offset = 0) => get<ContactListResponse>(`/product/contacts?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`),
  contact: (id: string) => get<Contact>(`/product/contacts/${id}`),
  contactAddressBooks: () => get<{ addressBooks: { engineId: string; name: string; isDefault: boolean }[] }>("/product/contacts/address-books"),
  createContact: (body: unknown) => post<Contact>("/product/contacts", body),
  updateContact: (id: string, body: unknown) => patch<Contact>(`/product/contacts/${id}`, body),
  importContacts: (body: unknown) => post<{ id: string; filename: string; rowCount: number; createdCount: number; updatedCount: number; skippedCount: number; duplicateCount: number; failedCount: number }>("/product/contact-imports", body, interactiveTimeout),
  contactImports: () => get<{ imports: { id: string; filename: string; rowCount: number; createdCount: number; updatedCount: number; skippedCount: number; duplicateCount: number; failedCount: number; createdAt: string }[] }>("/product/contact-imports"),
  contactImportRows: (id: string) => get<{ rows: { rowNumber: number; raw: Record<string, string>; status: string; error?: string | null }[] }>(`/product/contact-imports/${id}/rows`),
  calendars: (accountId?: string) => get<{ calendars: CalendarSummary[] }>(`/product/calendars${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ""}`),
  calendarEvents: (accountId: string, after: string, before: string) => get<{ events: CalendarEvent[] }>(`/product/calendar-events?accountId=${encodeURIComponent(accountId)}&after=${encodeURIComponent(after)}&before=${encodeURIComponent(before)}`),
  createCalendarEvent: (body: { accountId: string; calendarId: string; title: string; description?: string; start: string; durationMinutes: number; location?: string; meetingLink?: string; attendees: string[]; sendSchedulingMessages: boolean; timeZone?: string; allDay: boolean }) => post<CalendarEvent>("/product/calendar-events", body),
  updateCalendarEvent: (id: string, body: { accountId: string; calendarId: string; title: string; description?: string; start: string; durationMinutes: number; location?: string; meetingLink?: string; attendees: string[]; sendSchedulingMessages: boolean; timeZone?: string; allDay: boolean }) => patch<CalendarEvent>(`/product/calendar-events/${encodeURIComponent(id)}`, body),
  deleteCalendarEvent: (id: string, accountId: string) => request(`/product/calendar-events/${encodeURIComponent(id)}?accountId=${encodeURIComponent(accountId)}`, { method: "DELETE" }).then((res) => json<{ deleted: boolean; eventId: string }>(res)),
};