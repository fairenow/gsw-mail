import { accessToken, logout } from "./auth";

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

export interface SendResult {
  sendId: string;
  messageId: string | null;
  threadId: string | null;
  status: string;
  undoUntil: string | null;
  idempotentReplay?: boolean;
}

interface AccountsResponse {
  accounts: Account[];
}

interface MessagesResponse {
  messages: MessageSummary[];
}

export interface DraftInput {
  accountId: string;
  to?: string[];
  cc?: string[];
  subject?: string;
  textBody?: string;
  inReplyTo?: string;
  references?: string;
  mode?: "new" | "reply" | "replyAll" | "forward";
}

const headers = (jsonBody = false): Record<string, string> => {
  const token = accessToken();
  return {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(jsonBody ? { "content-type": "application/json" } : {}),
  };
};

const json = async <T,>(res: Response): Promise<T> => {
  if (res.status === 401) logout();
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `request failed: ${res.status}`);
  }
  return (await res.json()) as T;
};

const get = <T,>(url: string) => fetch(url, { headers: headers() }).then((res) => json<T>(res));

const post = async <T,>(url: string, body?: unknown): Promise<T> =>
  fetch(url, { method: "POST", headers: headers(!!body), body: body ? JSON.stringify(body) : undefined }).then((res) => json<T>(res));

export const api = {
  accounts: () => get<AccountsResponse>("/mail/accounts").then((r) => r.accounts),
  messages: (accountId: string, mailbox: string) => get<MessagesResponse>(`/mail/messages?accountId=${accountId}&mailbox=${mailbox}`).then((r) => r.messages),
  message: (accountId: string, engineId: string) => get<FullMessage>(`/mail/messages/${engineId}?accountId=${accountId}`),
  read: (accountId: string, engineId: string, seen: boolean) =>
    post(`/mail/messages/${engineId}/read`, { accountId, seen }),
  archive: (accountId: string, engineId: string) => post(`/mail/messages/${engineId}/archive`, { accountId }),
  trash: (accountId: string, engineId: string) => post(`/mail/messages/${engineId}/trash`, { accountId }),
  search: (accountId: string, q: string) => get<MessagesResponse>(`/mail/search?accountId=${accountId}&q=${encodeURIComponent(q)}`).then((r) => r.messages),
  send: (accountId: string, to: string[], body: { cc?: string[]; subject?: string; textBody?: string; inReplyTo?: string; references?: string; mode?: "new" | "reply" | "replyAll" | "forward"; clientRequestId?: string }) =>
    post<SendResult>("/mail/send", { accountId, to, ...body }),
  createDraft: (body: DraftInput) => post<{ engineId: string }>("/mail/drafts", body),
  updateDraft: (id: string, body: DraftInput) => fetch(`/mail/drafts/${id}`, { method: "PATCH", headers: headers(true), body: JSON.stringify(body) }).then(async (res) => { if (res.status === 401) logout(); if (!res.ok) throw new Error(`draft save failed: ${res.status}`); return (await res.json()) as { engineId: string }; }),
  sendDraft: (id: string, accountId: string, clientRequestId?: string, mode?: "new" | "reply" | "replyAll" | "forward") => post<SendResult>(`/mail/drafts/${id}/send`, { accountId, ...(clientRequestId ? { clientRequestId } : {}), ...(mode ? { mode } : {}) }),
  sendStatus: (sendId: string) => get<never>("/mail/sends/" + sendId),
  cancelSend: (sendId: string) => post<{ status: string }>(`/mail/sends/${sendId}/cancel`),
  retrySend: (sendId: string, accountId: string) => post<{ status: string }>(`/mail/sends/${sendId}/retry`, { accountId }),
};
