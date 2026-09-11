export interface Account {
  id: string;
  address: string;
  displayName: string | null;
  status: string;
}

export interface MessageSummary {
  engineId: string;
  threadId: string;
  subject: string;
  snippet?: string;
  date: string;
  from?: { name?: string; email: string };
  read: boolean;
  flagged: boolean;
  hasAttachments: boolean;
  mailbox: string;
}

export interface FullMessage extends MessageSummary {
  textBody?: string;
  htmlBody?: string;
}

interface AccountsResponse {
  accounts: Account[];
}

interface MessagesResponse {
  messages: MessageSummary[];
}

const json = async <T,>(res: Response): Promise<T> => {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `request failed: ${res.status}`);
  }
  return (await res.json()) as T;
};

const get = <T,>(url: string) => fetch(url).then((res) => json<T>(res));

export const api = {
  accounts: () => get<AccountsResponse>("/mail/accounts").then((r) => r.accounts),
  messages: (accountId: string, mailbox: string) => get<MessagesResponse>(`/mail/messages?accountId=${accountId}&mailbox=${mailbox}`).then((r) => r.messages),
  message: (accountId: string, engineId: string) => get<FullMessage>(`/mail/messages/${engineId}?accountId=${accountId}`),
  read: (accountId: string, engineId: string, seen: boolean) =>
    fetch(`/mail/messages/${engineId}/read`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId, seen }),
    }),
  archive: (accountId: string, engineId: string) =>
    fetch(`/mail/messages/${engineId}/archive`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId }),
    }),
  trash: (accountId: string, engineId: string) =>
    fetch(`/mail/messages/${engineId}/trash`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId }),
    }),
  search: (accountId: string, q: string) => get<MessagesResponse>(`/mail/search?accountId=${accountId}&q=${encodeURIComponent(q)}`).then((r) => r.messages),
};