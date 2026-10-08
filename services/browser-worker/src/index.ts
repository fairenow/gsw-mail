import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";

const port = Number(process.env.PORT ?? "3000");
const token = process.env.BROWSER_WORKER_TOKEN?.trim() ?? "";
const sessionTtlMs = Number(process.env.BROWSER_SESSION_TTL_MS ?? String(10 * 60_000));
const maxSessions = Number(process.env.BROWSER_MAX_SESSIONS ?? "20");
const maxSessionsPerOwner = Number(process.env.BROWSER_MAX_SESSIONS_PER_OWNER ?? "3");
const navigationTimeoutMs = Number(process.env.BROWSER_NAVIGATION_TIMEOUT_MS ?? "30000");
const maxResponseText = Number(process.env.BROWSER_MAX_RESPONSE_TEXT ?? "40000");

if (token.length < 24) {
  throw new Error("BROWSER_WORKER_TOKEN must be configured with at least 24 characters.");
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

interface BrowserSession {
  id: string;
  ownerKey: string;
  context: BrowserContext;
  page: Page;
  createdAt: number;
  lastUsedAt: number;
}

interface ActionBody {
  action?: unknown;
  input?: unknown;
}

const sessions = new Map<string, BrowserSession>();
let browserPromise: Promise<Browser> | undefined;

const json = (res: ServerResponse, status: number, body: unknown) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
};

const textSnippet = (value: string, max = maxResponseText) =>
  value.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").trim().slice(0, max);

const tokenMatches = (candidate: string) => {
  const expected = Buffer.from(token);
  const actual = Buffer.from(candidate);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

const authenticate = (req: IncomingMessage) => {
  const authorization = req.headers.authorization ?? "";
  const candidate = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!candidate || !tokenMatches(candidate)) throw new HttpError(401, "Unauthorized.");

  const userId = typeof req.headers["x-gsw-user-id"] === "string" ? req.headers["x-gsw-user-id"].trim() : "";
  const accountId = typeof req.headers["x-gsw-account-id"] === "string" ? req.headers["x-gsw-account-id"].trim() : "";
  if (!userId || !accountId) throw new HttpError(400, "GSW user and account headers are required.");
  return { userId, accountId, ownerKey: `${userId}:${accountId}` };
};

const readJson = async (req: IncomingMessage): Promise<ActionBody> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) throw new HttpError(413, "Request body is too large.");
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as ActionBody;
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const stringValue = (value: unknown, name: string, options?: { optional?: boolean; max?: number }) => {
  if (value === undefined || value === null) {
    if (options?.optional) return undefined;
    throw new HttpError(400, `${name} is required.`);
  }
  if (typeof value !== "string") throw new HttpError(400, `${name} must be a string.`);
  const trimmed = value.trim();
  if (!trimmed && !options?.optional) throw new HttpError(400, `${name} is required.`);
  if (options?.max && trimmed.length > options.max) throw new HttpError(400, `${name} is too long.`);
  return trimmed || undefined;
};

const isPrivateIpv4 = (address: string) => {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && (b === 0 || b === 168)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
};

const isPrivateIpv6 = (address: string) => {
  const normalized = address.toLowerCase().split("%")[0] ?? "";
  if (!normalized || normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("ff")) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ? isPrivateIpv4(mapped) : false;
};

const assertPublicAddress = (address: string) => {
  const version = isIP(address);
  if (version === 4 && isPrivateIpv4(address)) throw new HttpError(403, "Private or local network destinations are blocked.");
  if (version === 6 && isPrivateIpv6(address)) throw new HttpError(403, "Private or local network destinations are blocked.");
  if (version === 0) throw new HttpError(403, "Unresolvable network destination.");
};

const assertSafeHttpUrl = async (rawUrl: string) => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new HttpError(400, "Invalid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HttpError(403, "Only HTTP and HTTPS URLs are allowed.");
  }
  if (url.username || url.password) throw new HttpError(403, "Credential-bearing URLs are blocked.");

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new HttpError(403, "Local and internal hostnames are blocked.");
  }

  if (isIP(hostname)) {
    assertPublicAddress(hostname);
  } else {
    let records;
    try {
      records = await lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new HttpError(502, "Unable to resolve destination hostname.");
    }
    if (!records.length) throw new HttpError(502, "Destination hostname has no addresses.");
    for (const record of records) assertPublicAddress(record.address);
  }

  return url.toString();
};

const ensureBrowser = async () => {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      chromiumSandbox: false,
      args: ["--disable-dev-shm-usage", "--disable-background-networking"],
    }).then((browser) => {
      browser.once("disconnected", () => { browserPromise = undefined; });
      return browser;
    }).catch((error) => {
      browserPromise = undefined;
      throw error;
    });
  }
  return browserPromise;
};

const closeSession = async (session: BrowserSession) => {
  sessions.delete(session.id);
  await session.context.close().catch(() => undefined);
};

const enforceSessionLimits = async (ownerKey: string) => {
  const ownerSessions = [...sessions.values()]
    .filter((session) => session.ownerKey === ownerKey)
    .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  while (ownerSessions.length >= maxSessionsPerOwner) {
    const oldest = ownerSessions.shift();
    if (oldest) await closeSession(oldest);
  }

  while (sessions.size >= maxSessions) {
    const oldest = [...sessions.values()].sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
    if (!oldest) break;
    await closeSession(oldest);
  }
};

const createSession = async (ownerKey: string) => {
  await enforceSessionLimits(ownerKey);
  const browser = await ensureBrowser();
  const context = await browser.newContext({
    acceptDownloads: false,
    viewport: { width: 1365, height: 900 },
    locale: "en-US",
  });

  await context.route("**/*", async (route) => {
    const request = route.request();
    const rawUrl = request.url();
    if (rawUrl.startsWith("data:") || rawUrl.startsWith("blob:") || rawUrl === "about:blank") {
      await route.continue();
      return;
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method().toUpperCase())) {
      await route.abort("blockedbyclient");
      return;
    }
    try {
      await assertSafeHttpUrl(rawUrl);
      await route.continue();
    } catch {
      await route.abort("blockedbyclient");
    }
  });

  await context.routeWebSocket("**/*", (webSocket) => {
    webSocket.close({ code: 1008, reason: "WebSockets are disabled in the GSW browser worker." });
  });

  const page = await context.newPage();
  page.setDefaultNavigationTimeout(navigationTimeoutMs);
  page.setDefaultTimeout(15_000);
  page.on("download", (download) => { void download.cancel(); });

  const now = Date.now();
  const session: BrowserSession = {
    id: randomUUID(),
    ownerKey,
    context,
    page,
    createdAt: now,
    lastUsedAt: now,
  };
  sessions.set(session.id, session);
  return session;
};

const getSession = async (ownerKey: string, requestedId?: string) => {
  if (!requestedId) return createSession(ownerKey);
  const session = sessions.get(requestedId);
  if (!session || session.ownerKey !== ownerKey) throw new HttpError(404, "Browser session not found.");
  if (Date.now() - session.lastUsedAt > sessionTtlMs) {
    await closeSession(session);
    throw new HttpError(410, "Browser session expired.");
  }
  session.lastUsedAt = Date.now();
  return session;
};

const pageSummary = async (session: BrowserSession, max = 8_000) => ({
  sessionId: session.id,
  url: session.page.url(),
  title: await session.page.title().catch(() => ""),
  text: textSnippet(await session.page.locator("body").innerText().catch(() => ""), max),
});

const navigate = async (page: Page, rawUrl: string) => {
  const safeUrl = await assertSafeHttpUrl(rawUrl);
  await page.goto(safeUrl, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs });
  if (page.url().startsWith("http")) await assertSafeHttpUrl(page.url());
};

const resolveLocator = (page: Page, selector?: string, text?: string): Locator => {
  if (selector) return page.locator(selector).first();
  if (text) return page.getByText(text, { exact: false }).first();
  throw new HttpError(400, "selector or text is required.");
};

const assertSafeClick = async (locator: Locator) => {
  const count = await locator.count();
  if (!count) throw new HttpError(404, "Clickable element not found.");

  const metadata = await locator.evaluate((element) => {
    const html = element as HTMLElement;
    const input = html instanceof HTMLInputElement ? html : null;
    const button = html instanceof HTMLButtonElement ? html : null;
    const anchor = html instanceof HTMLAnchorElement ? html : null;
    return {
      tag: html.tagName.toLowerCase(),
      inputType: input?.type?.toLowerCase() ?? null,
      buttonType: button?.type?.toLowerCase() ?? null,
      href: anchor?.href ?? null,
      inForm: Boolean(html.closest("form")),
    };
  });

  if (metadata.inputType === "file" || metadata.inputType === "submit" || metadata.inputType === "image") {
    throw new HttpError(403, "File upload and submit controls are blocked.");
  }
  if (metadata.tag === "button" && metadata.inForm && (!metadata.buttonType || metadata.buttonType === "submit")) {
    throw new HttpError(403, "Form submit controls are blocked.");
  }
  if (metadata.href) await assertSafeHttpUrl(metadata.href);
};

const handleAction = async (body: ActionBody, ownerKey: string) => {
  const action = stringValue(body.action, "action", { max: 50 });
  const input = asRecord(body.input);
  const requestedSessionId = stringValue(input.sessionId, "sessionId", { optional: true, max: 500 });

  switch (action) {
    case "search": {
      const query = stringValue(input.query, "query", { max: 1_000 })!;
      const session = await getSession(ownerKey, requestedSessionId);
      await navigate(session.page, `https://www.bing.com/search?q=${encodeURIComponent(query)}`);
      const results = await session.page.locator("li.b_algo h2 a").evaluateAll((anchors) =>
        anchors.slice(0, 10).map((anchor) => ({
          title: (anchor.textContent ?? "").trim(),
          url: (anchor as HTMLAnchorElement).href,
        })).filter((item) => item.title && item.url),
      ).catch(() => []);
      session.lastUsedAt = Date.now();
      return { ...(await pageSummary(session, 4_000)), data: { query, results } };
    }
    case "open": {
      const url = stringValue(input.url, "url", { max: 4_000 })!;
      const session = await getSession(ownerKey, requestedSessionId);
      await navigate(session.page, url);
      session.lastUsedAt = Date.now();
      return pageSummary(session);
    }
    case "read": {
      const sessionId = stringValue(input.sessionId, "sessionId", { max: 500 })!;
      const selector = stringValue(input.selector, "selector", { optional: true, max: 1_000 });
      const session = await getSession(ownerKey, sessionId);
      const rawText = selector
        ? await session.page.locator(selector).first().innerText()
        : await session.page.locator("body").innerText();
      session.lastUsedAt = Date.now();
      return {
        sessionId: session.id,
        url: session.page.url(),
        title: await session.page.title(),
        text: textSnippet(rawText),
      };
    }
    case "screenshot": {
      const sessionId = stringValue(input.sessionId, "sessionId", { max: 500 })!;
      const session = await getSession(ownerKey, sessionId);
      const bytes = await session.page.screenshot({ type: "jpeg", quality: 55, fullPage: false });
      session.lastUsedAt = Date.now();
      return {
        sessionId: session.id,
        url: session.page.url(),
        title: await session.page.title(),
        screenshotUrl: `data:image/jpeg;base64,${bytes.toString("base64")}`,
      };
    }
    case "click": {
      const sessionId = stringValue(input.sessionId, "sessionId", { max: 500 })!;
      const selector = stringValue(input.selector, "selector", { optional: true, max: 1_000 });
      const targetText = stringValue(input.text, "text", { optional: true, max: 500 });
      if (!selector && !targetText) throw new HttpError(400, "selector or text is required.");
      if (input.preventSubmit !== true) throw new HttpError(403, "preventSubmit=true is required.");
      const session = await getSession(ownerKey, sessionId);
      const locator = resolveLocator(session.page, selector, targetText);
      await assertSafeClick(locator);
      await locator.click({ timeout: 15_000 });
      await session.page.waitForTimeout(500);
      if (session.page.url().startsWith("http")) await assertSafeHttpUrl(session.page.url());
      session.lastUsedAt = Date.now();
      return pageSummary(session);
    }
    case "type": {
      const sessionId = stringValue(input.sessionId, "sessionId", { max: 500 })!;
      const selector = stringValue(input.selector, "selector", { max: 1_000 })!;
      const value = typeof input.text === "string" ? input.text : undefined;
      if (value === undefined || value.length > 20_000) throw new HttpError(400, "text is required and must be 20,000 characters or fewer.");
      if (input.preventSubmit !== true) throw new HttpError(403, "preventSubmit=true is required.");
      const session = await getSession(ownerKey, sessionId);
      const locator = session.page.locator(selector).first();
      if (!await locator.count()) throw new HttpError(404, "Input element not found.");
      const type = await locator.getAttribute("type");
      if (type?.toLowerCase() === "file") throw new HttpError(403, "File upload controls are blocked.");
      await locator.fill(value, { timeout: 15_000 });
      session.lastUsedAt = Date.now();
      return pageSummary(session, 2_000);
    }
    default:
      throw new HttpError(400, "Unsupported browser action.");
  }
};

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      json(res, 200, {
        ok: true,
        service: "gsw-browser",
        sessions: sessions.size,
        uptimeSeconds: Math.round(process.uptime()),
      });
      return;
    }

    if (req.method !== "POST" || req.url !== "/v1/actions") {
      json(res, 404, { error: "Not found." });
      return;
    }

    const auth = authenticate(req);
    const body = await readJson(req);
    const result = await handleAction(body, auth.ownerKey);
    json(res, 200, { result });
  } catch (error) {
    if (error instanceof HttpError) {
      json(res, error.status, { error: { message: error.message } });
      return;
    }
    console.error("[browser-worker] request failed", error);
    json(res, 500, { error: { message: "Browser worker request failed." } });
  }
});

const cleanupTimer = setInterval(() => {
  const cutoff = Date.now() - sessionTtlMs;
  for (const session of sessions.values()) {
    if (session.lastUsedAt < cutoff) void closeSession(session);
  }
}, Math.max(30_000, Math.min(sessionTtlMs / 2, 60_000)));
cleanupTimer.unref();

const shutdown = async () => {
  clearInterval(cleanupTimer);
  server.close();
  await Promise.all([...sessions.values()].map(closeSession));
  const browser = browserPromise ? await browserPromise.catch(() => undefined) : undefined;
  await browser?.close().catch(() => undefined);
  process.exit(0);
};

process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });

server.listen(port, "0.0.0.0", () => {
  console.log(`[browser-worker] listening on :${port}`);
});
