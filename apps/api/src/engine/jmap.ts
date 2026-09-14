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
  constructor(message: string, readonly type: string, readonly callId?: string, readonly response?: unknown, readonly status?: number) {
    super(message);
    this.name = "JmapError";
  }
}

export type JmapMethodCall = [string, Record<string, unknown>, string];

export interface JmapClientOptions {
  baseUrl: string;
  token?: string;
  sessionTtlMs: number;
  fetchImpl?: typeof fetch;
  onSlowOperation?: (operation: string, durationMs: number) => void;
}

const abs = (base: string, url: string): string => {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${base.replace(/\/$/, "")}/${url.replace(/^\//, "")}`;
};

const authorizationHeader = (opts: JmapClientOptions): string => {
  if (opts.token) {
    return `Bearer ${opts.token}`;
  }
  throw new Error("JMAP client requires a user-scoped Bearer token");
};

export class JmapClient {
  constructor(private readonly opts: JmapClientOptions) {}

  readonly authHeader = (): string => authorizationHeader(this.opts);

  private sessionCache: { at: number; session: JmapSession } | undefined;

  private get fetchImpl(): typeof fetch {
    return this.opts.fetchImpl ?? fetch;
  }

  async session(force = false): Promise<JmapSession> {
    const now = Date.now();
    const started = performance.now();
    if (!force && this.sessionCache && now - this.sessionCache.at < this.opts.sessionTtlMs) {
      return this.sessionCache.session;
    }
    const res = await this.fetchImpl(abs(this.opts.baseUrl, "/.well-known/jmap"), {
      method: "GET",
      headers: { Accept: "application/json", Authorization: authorizationHeader(this.opts) },
    });
    this.reportSlow("JMAP session", started);
    if (!res.ok) {
      throw new JmapError(
        `JMAP session request failed: HTTP ${res.status} ${res.statusText}`,
        res.status === 401 ? "mail_identity_rejected" : "session_failed",
        undefined,
        undefined,
        res.status,
      );
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
    const started = performance.now();
    const res = await this.fetchImpl(session.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authorizationHeader(this.opts) },
      body: JSON.stringify({
        using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail", "urn:ietf:params:jmap:submission", ...(methods.some(([name]) => name.startsWith("AddressBook/") || name.startsWith("ContactCard/")) ? ["urn:ietf:params:jmap:contacts"] : [])],
        methodCalls: methods,
      }),
    });
    this.reportSlow(methods.map(([name]) => name).join(", "), started);
    if (!res.ok) {
      throw new JmapError(
        `JMAP request failed: HTTP ${res.status} ${res.statusText}`,
        res.status === 401 ? "mail_identity_rejected" : "request_failed",
        undefined,
        undefined,
        res.status,
      );
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

  private reportSlow(operation: string, started: number): void {
    const durationMs = performance.now() - started;
    if (durationMs > 250) this.opts.onSlowOperation?.(operation, durationMs);
  }
}
