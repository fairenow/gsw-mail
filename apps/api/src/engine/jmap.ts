export interface JmapSession {
  apiUrl: string;
  uploadUrl: string;
  downloadUrl: string;
  blobUrl: string;
  eventSourceUrl: string | null;
  accounts: Record<string, { name: string; isPrimary: boolean; accountCapabilities: Record<string, unknown> }>;
  primaryAccounts: Record<string, string>;
}

export class JmapError extends Error {
  constructor(message: string, readonly type: string, readonly callId?: string, readonly response?: unknown) {
    super(message);
    this.name = "JmapError";
  }
}

export type JmapMethodCall = [string, Record<string, unknown>, string];

export interface JmapClientOptions {
  baseUrl: string;
  token: string;
  sessionTtlMs: number;
  fetchImpl?: typeof fetch;
}

const abs = (base: string, url: string): string => {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${base.replace(/\/$/, "")}/${url.replace(/^\//, "")}`;
};

export class JmapClient {
  constructor(private readonly opts: JmapClientOptions) {}

  private sessionCache: { at: number; session: JmapSession } | undefined;

  private get fetchImpl(): typeof fetch {
    return this.opts.fetchImpl ?? fetch;
  }

  async session(force = false): Promise<JmapSession> {
    const now = Date.now();
    if (!force && this.sessionCache && now - this.sessionCache.at < this.opts.sessionTtlMs) {
      return this.sessionCache.session;
    }
    const res = await this.fetchImpl(abs(this.opts.baseUrl, "/.well-known/jmap"), {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${this.opts.token}` },
    });
    if (!res.ok) {
      throw new JmapError(`JMAP session request failed: HTTP ${res.status} ${res.statusText}`, "session_failed");
    }
    const body = (await res.json()) as JmapSession;
    if (!body.apiUrl || typeof body.apiUrl !== "string") {
      throw new JmapError("JMAP session response missing apiUrl", "session_invalid");
    }
    body.apiUrl = abs(this.opts.baseUrl, body.apiUrl);
    body.uploadUrl = body.uploadUrl ? abs(this.opts.baseUrl, body.uploadUrl) : `${body.apiUrl}/upload/`;
    body.downloadUrl = body.downloadUrl ? abs(this.opts.baseUrl, body.downloadUrl) : `${body.apiUrl}/download/`;
    body.blobUrl = body.blobUrl ? abs(this.opts.baseUrl, body.blobUrl) : body.downloadUrl;
    this.sessionCache = { at: now, session: body };
    return body;
  }

  resolveAccountId(session: JmapSession, engineAccountId: string): string {
    if (session.accounts[engineAccountId]) return engineAccountId;
    for (const [id, acc] of Object.entries(session.accounts)) {
      if (acc.name === engineAccountId) return id;
      if (acc.name?.toLowerCase() === engineAccountId.toLowerCase()) return id;
    }
    throw new JmapError(`no JMAP account found for mail account "${engineAccountId}"`, "account_not_found");
  }

  async call(methods: JmapMethodCall[]): Promise<[string, Record<string, unknown>, string | null][]> {
    const session = await this.session();
    const res = await this.fetchImpl(session.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.opts.token}` },
      body: JSON.stringify({
        using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail", "urn:ietf:params:jmap:submission"],
        methodCalls: methods,
      }),
    });
    if (!res.ok) {
      throw new JmapError(`JMAP request failed: HTTP ${res.status} ${res.statusText}`, "request_failed");
    }
    const body = (await res.json()) as { methodResponses: [string, Record<string, unknown>, string | null][] };
    const responses = body.methodResponses ?? [];
    for (let i = 0; i < responses.length; i += 1) {
      const [name, payload, callId] = responses[i]!;
      if (name === "error") {
        const type = String((payload as { type?: string }).type ?? "unknown_error");
        const description = String((payload as { description?: unknown }).description ?? type);
        throw new JmapError(`JMAP error: ${description}`, type, callId ?? undefined, payload);
      }
      if (name !== methods[i]?.[0] && name !== "error") {
        throw new JmapError(`JMAP ${name} failed`, (payload as { type?: string }).type ?? "method_failed", callId ?? undefined, payload);
      }
    }
    return responses;
  }
}