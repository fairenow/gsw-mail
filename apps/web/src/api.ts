import { logout } from "./auth";

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

export interface FullMessage extends MessageSummary {
  textBody?: string;
  htmlBody?: string;
  attachments?: { engineId: string; filename: string; contentType: string; size: number; inline: boolean }[];
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

interface AccountsResponse {
  accounts: Account[];
}

interface MessagesResponse {
  messages: MessageSummary[];
}

export interface MailboxFolderStats {
  total: number;
  unread: number;
}

interface MailboxStatsResponse {
  folders: Record<string, MailboxFolderStats>;
}

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

const headers = (jsonBody = false): Record<string, string> => {
  return {
    ...(jsonBody ? { "content-type": "application/json" } : {}),
  };
};

const json = async <T,>(res: Response): Promise<T> => {
  if (res.status === 401) void logout();
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const details = body as { message?: string; error?: string };
    throw new Error(details.message ?? details.error ?? `request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
};

const get = <T,>(url: string) => fetch(url, { headers: headers(), credentials: "include" }).then((res) => json<T>(res));

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

export const api = {
  setup: () => get<SetupState>("/api/setup"),
  updateWorkspace: (name: string) => patch<Pick<SetupState, "workspace" | "currentStep">>("/api/setup/workspace", { name }),
  addSetupDomain: (domain: string) => post<Pick<SetupState, "domain" | "currentStep">>("/api/setup/domain", { domain }),
  accounts: () => get<AccountsResponse>("/mail/accounts").then((r) => r.accounts),
  messages: (accountId: string, mailbox: string, limit = 50) => get<MessagesResponse>(`/mail/messages?accountId=${accountId}&mailbox=${mailbox}&limit=${limit}`).then((r) => r.messages),
  mailboxStats: (accountId: string) => get<MailboxStatsResponse>(`/mail/mailboxes/stats?accountId=${encodeURIComponent(accountId)}`).then((r) => r.folders),
  message: (accountId: string, engineId: string) => get<FullMessage>(`/mail/messages/${engineId}?accountId=${accountId}`),
  read: (accountId: string, engineId: string, seen: boolean) =>
    post(`/mail/messages/${engineId}/read`, { accountId, seen }),
  archive: (accountId: string, engineId: string) => post(`/mail/messages/${engineId}/archive`, { accountId }),
  trash: (accountId: string, engineId: string) => post(`/mail/messages/${engineId}/trash`, { accountId }),
  move: (accountId: string, engineId: string, mailbox: string) => post(`/mail/messages/${engineId}/move`, { accountId, mailbox }),
  destroy: (accountId: string, engineId: string) => post(`/mail/messages/${engineId}/destroy`, { accountId }),
  emptyTrash: (accountId: string) => post<{ deleted: number }>("/mail/messages/empty-trash", { accountId }),
  search: (accountId: string, q: string) => get<MessagesResponse>(`/mail/search?accountId=${accountId}&q=${encodeURIComponent(q)}`).then((r) => r.messages),
  send: (accountId: string, to: string[], body: { cc?: string[]; bcc?: string[]; subject?: string; textBody?: string; htmlBody?: string; inReplyTo?: string; references?: string; mode?: "new" | "reply" | "replyAll" | "forward"; clientRequestId?: string; templateKey?: string }) =>
    post<SendResult>("/mail/send", { accountId, to, ...body }, interactiveTimeout),
  createDraft: (body: DraftInput) => post<{ engineId: string }>("/mail/drafts", body, interactiveTimeout),
  updateDraft: (id: string, body: DraftInput) => patch<{ engineId: string }>(`/mail/drafts/${id}`, body, interactiveTimeout).then((result) => result ?? { engineId: id }),
  sendDraft: (id: string, accountId: string, clientRequestId?: string, mode?: "new" | "reply" | "replyAll" | "forward", templateKey?: string) => post<SendResult>(`/mail/drafts/${id}/send`, { accountId, ...(clientRequestId ? { clientRequestId } : {}), ...(mode ? { mode } : {}), ...(templateKey ? { templateKey } : {}) }, interactiveTimeout),
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
};
