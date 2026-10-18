import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { count, eq, inArray, sql } from "drizzle-orm";
import { createServer, type Server as HttpServer } from "node:http";
import { generateKeyPairSync, randomUUID, type KeyObject } from "node:crypto";
import { SignJWT, exportJWK } from "jose";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://gsw_mail:gsw_mail@localhost:5432/gsw_mail_test";
if (new URL(process.env.DATABASE_URL).pathname !== "/gsw_mail_test") throw new Error("Integration tests require gsw_mail_test");
process.env.NODE_ENV = "test";
process.env.DELIVERY_WEBHOOK_SECRET = "";
process.env.SEND_DELAY_SECONDS = "0";
process.env.OUTBOUND_RELAY = "null";
process.env.MAIL_ENGINE = "demo";
process.env.DEV_USER_ID = "";
process.env.GSW_MCP_RESOURCE_URL = "https://api.mcp.gsw.test/resource";
process.env.MCP_APPROVAL_PAYLOAD_KEY = Buffer.alloc(32, 7).toString("base64");

type Json = Record<string, any>;
interface ApiResult {
  status: number;
  json: Json;
}

let baseUrl = "";
let db: typeof import("./db/client.js").db;
let pool: import("pg").Pool;
let schema: typeof import("./db/schema.js");
let queue: typeof import("./outbound/queue.js");
let appInstance: import("fastify").FastifyInstance | undefined;
let dbAvailable = true;
let ramonId = "";
let alyssaId = "";
let ramonAccountId = "";
let alyssaAccountId = "";
let communityAccountId = "";
let roAccountId = "";
let mcpJwksServer: HttpServer | undefined;
let mcpTokenSigningKey: KeyObject | undefined;
const mcpClientId = "gsw-mcp-integration-client";
const mcpAuthSubject = "auth-ramon-mcp";
const mcpJwksKid = "mcp-integration-key";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "..");

async function seed() {
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: "IT Org", slug: "it-org" })
    .onConflictDoNothing()
    .returning({ id: schema.organizations.id });
  const organizationId =
    org?.id ?? (await db.select({ id: schema.organizations.id }).from(schema.organizations).where(eq(schema.organizations.slug, "it-org")).limit(1))[0]!.id;
  const [domain] = await db
    .insert(schema.domains)
    .values({ organizationId, name: "it.example.com", status: "verified" })
    .onConflictDoNothing()
    .returning({ id: schema.domains.id });
  const domainId = domain?.id ?? (await db.select({ id: schema.domains.id }).from(schema.domains).where(eq(schema.domains.name, "it.example.com")).limit(1))[0]!.id;

  await db.insert(schema.users).values([
    { id: ramonId, identityProvider: "gsw", identitySubject: ramonId, email: "ramon@it.example.com", emailVerified: true, status: "active" },
    { id: alyssaId, identityProvider: "gsw", identitySubject: alyssaId, email: "alyssa@it.example.com", emailVerified: true, status: "active" },
  ]);

  await db.insert(schema.organizationMemberships).values([
    { organizationId, userId: ramonId, role: "owner", status: "active" },
    { organizationId, userId: alyssaId, role: "member", status: "active" },
  ]);

  const ensure = async (localPart: string, owner: string): Promise<string> => {
    const [acc] = await db
      .insert(schema.emailAccounts)
      .values({
        workspaceId: organizationId,
        domainId,
        userId: owner,
        localPart,
        address: `${localPart}@it.example.com`,
        displayName: localPart,
        status: "active",
      })
      .onConflictDoNothing()
      .returning({ id: schema.emailAccounts.id });
    const accountId =
      acc?.id ??
      (await db.select({ id: schema.emailAccounts.id }).from(schema.emailAccounts).where(eq(schema.emailAccounts.address, `${localPart}@it.example.com`)).limit(1))[0]!
        .id;
    const roles = ["inbox", "sent", "drafts", "spam", "trash", "archive"] as const;
    await db.insert(schema.mailboxes).values(roles.map((role) => ({ accountId, role, engineName: role })));
    return accountId;
  };

  ramonAccountId = await ensure("ramon", ramonId);
  alyssaAccountId = await ensure("alyssa", alyssaId);
  communityAccountId = await ensure("community", ramonId);
  roAccountId = await ensure("ro", ramonId);

  await db.insert(schema.mailAccountMemberships).values([
    { accountId: ramonAccountId, userId: ramonId, role: "owner" },
    { accountId: alyssaAccountId, userId: alyssaId, role: "owner" },
    { accountId: communityAccountId, userId: ramonId, role: "owner" },
    { accountId: communityAccountId, userId: alyssaId, role: "delegate" },
    { accountId: roAccountId, userId: alyssaId, role: "read_only" },
  ]);

  await db.insert(schema.aliases).values({ domainId, source: "hello", targetAccountId: communityAccountId }).onConflictDoNothing();
}

async function request(method: string, path: string, opts: { userId?: string; body?: unknown } = {}): Promise<ApiResult> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(opts.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(opts.userId ? { "x-gsw-user-id": opts.userId } : {}),
    },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  const text = await res.text();
  let json: Json = {};
  try {
    json = text ? (JSON.parse(text) as Json) : {};
  } catch {
    json = {};
  }
  if (res.status >= 400) console.log(`[req] ${method} ${path} -> ${res.status}`, JSON.stringify(json).slice(0, 300));
  return { status: res.status, json };
}

async function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function ensureMcpIdentityFixtures() {
  await db.insert(schema.authUsers).values({ id: mcpAuthSubject, name: "Ramon MCP", email: "ramon-mcp@it.example.com", emailVerified: true }).onConflictDoNothing();
  await db.update(schema.users).set({ authUserId: mcpAuthSubject }).where(eq(schema.users.id, ramonId));
  await db.insert(schema.oauthClient).values({ id: mcpClientId, clientId: mcpClientId, disabled: false, name: "MCP integration client", redirectUris: ["https://client.mcp.test/callback"] }).onConflictDoNothing();
  await db.insert(schema.oauthConsent).values({
    id: `consent-${mcpClientId}`, clientId: mcpClientId, userId: mcpAuthSubject,
    scopes: ["openid", "mail.read", "mail.write"], createdAt: new Date(), updatedAt: new Date(),
  }).onConflictDoNothing();
}

async function mintMcpToken(options: { scope?: string; audience?: string; issuer?: string; subject?: string; clientId?: string } = {}): Promise<string> {
  if (!mcpTokenSigningKey) throw new Error("MCP signing key unavailable");
  return new SignJWT({ client_id: options.clientId ?? mcpClientId, scope: options.scope ?? "openid mail.read mail.write" })
    .setProtectedHeader({ alg: "ES256", kid: mcpJwksKid })
    .setIssuer(options.issuer ?? `${process.env.BETTER_AUTH_URL}/api/auth`)
    .setAudience(options.audience ?? process.env.GSW_MCP_RESOURCE_URL!)
    .setSubject(options.subject ?? mcpAuthSubject)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(mcpTokenSigningKey);
}

async function mcpRpc(payload: Record<string, unknown>, token?: string): Promise<ApiResult> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json: Json = {};
  try { json = text ? (JSON.parse(text) as Json) : {}; } catch { json = { raw: text }; }
  if (res.status >= 400) console.log(`[mcp] ${String(payload.method)} -> ${res.status}`, JSON.stringify(json).slice(0, 300));
  return { status: res.status, json };
}

let mcpRequestId = 0;
function mcpRequest(method: string, params: Record<string, unknown> = {}): Record<string, unknown> {
  mcpRequestId += 1;
  return { jsonrpc: "2.0", id: mcpRequestId, method, params };
}

async function mcpToolCall(name: string, args: Record<string, unknown>, token: string): Promise<{ status: number; isError: boolean; body: Json }> {
  const res = await mcpRpc(mcpRequest("tools/call", { name, arguments: args }), token);
  const result = res.json?.result as Json | undefined;
  const text = result?.content?.[0]?.text;
  let body: Json = {};
  if (typeof text === "string") {
    try { body = JSON.parse(text) as Json; } catch { body = { text }; }
  }
  return { status: res.status, isError: Boolean(result?.isError), body };
}

async function decideMcpApproval(input: {
  approvalId: string; decision: "approved" | "rejected"; digest: string;
  origin?: string; authorization?: string;
}): Promise<ApiResult> {
  const res = await fetch(`${baseUrl}/product/mcp/approvals/${input.approvalId}/decision`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "mcp_review_session=not-a-real-session",
      "x-gsw-user-id": ramonId,
      ...(input.origin ? { origin: input.origin } : {}),
      ...(input.authorization ? { authorization: input.authorization } : {}),
    },
    body: JSON.stringify({ decision: input.decision, reviewedArgumentsDigest: input.digest }),
  });
  const text = await res.text();
  let json: Json = {};
  try { json = text ? (JSON.parse(text) as Json) : {}; } catch { json = {}; }
  if (res.status >= 400) console.log(`[mcp-approval] ${input.decision} -> ${res.status}`, JSON.stringify(json).slice(0, 300));
  return { status: res.status, json };
}

async function ensureMcpWriteGrants() {
  const { grantAiScope } = await import("./ai/agentState.js");
  await grantAiScope({ userId: ramonId, accountId: ramonAccountId, scope: "mail.read", source: "integration_test" });
  await grantAiScope({ userId: ramonId, accountId: ramonAccountId, scope: "mail.write", source: "integration_test" });
}

before(async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  mcpTokenSigningKey = privateKey;
  const publicJwk = { ...(await exportJWK(publicKey)), kid: mcpJwksKid, alg: "ES256", use: "sig" };
  mcpJwksServer = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ keys: [publicJwk] }));
  });
  await new Promise<void>((resolve) => { mcpJwksServer!.listen(0, "127.0.0.1", resolve); });
  const jwksAddress = mcpJwksServer.address();
  process.env.BETTER_AUTH_URL = `http://127.0.0.1:${typeof jwksAddress === "object" && jwksAddress ? jwksAddress.port : 0}`;

  const recent = await import("./db/client.js");
  db = recent.db;
  pool = recent.pool;
  dbAvailable = await recent.pingDatabase().catch(() => false);
  if (!dbAvailable) throw new Error("Test Postgres unavailable; start gsw_mail_test first");
  schema = await import("./db/schema.js");
  const migrator = await import("drizzle-orm/node-postgres/migrator");
  queue = await import("./outbound/queue.js");

  await migrator.migrate(db, { migrationsFolder: join(projectRoot, "drizzle") });

  const tables = await pool.query<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public'");
  const names = tables.rows.map((r) => r.tablename).join(", ");
  if (names) await pool.query(`truncate ${names} restart identity cascade`);

  ramonId = "ramon-prod";
  alyssaId = "alyssa-prod";
  await seed();

  const { buildApp } = await import("./app.js");
  appInstance = buildApp();
  await appInstance.listen({ port: 0, host: "127.0.0.1" });
  const address = appInstance.server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

after(async () => {
  if (appInstance) await appInstance.close().catch(() => undefined);
  if (pool) await pool.end().catch(() => undefined);
  if (mcpJwksServer) await new Promise<void>((resolve) => mcpJwksServer!.close(() => resolve()));
});

test("mailbox isolation: a private account is invisible and unreachable to outsiders", async (t) => {
  if (!dbAvailable) return t.skip("postgres unavailable");
  const ramonAccounts = await request("GET", "/mail/accounts", { userId: ramonId });
  const alyssaAccounts = await request("GET", "/mail/accounts", { userId: alyssaId });

  const ramonAddresses = ramonAccounts.json.accounts as { address: string }[];
  const alyssaAddresses = alyssaAccounts.json.accounts as { address: string }[];

  assert.ok(ramonAddresses.some((a) => a.address === "ramon@it.example.com"));
  assert.ok(ramonAddresses.some((a) => a.address === "community@it.example.com"));
  assert.ok(!ramonAddresses.some((a) => a.address === "alyssa@it.example.com"));

  assert.ok(alyssaAddresses.some((a) => a.address === "alyssa@it.example.com"));
  assert.ok(alyssaAddresses.some((a) => a.address === "community@it.example.com"));
  assert.ok(!alyssaAddresses.some((a) => a.address === "ramon@it.example.com"));

  const denied = await request("GET", `/mail/messages?accountId=${ramonAccountId}`, { userId: alyssaId });
  assert.equal(denied.status, 403);
});

test("just-in-time provisioning creates an isolated user mailbox graph", async () => {
  const { provisionUserFromIdentity } = await import("./auth/provision.js");
  const user = await provisionUserFromIdentity("gsw", "newuser@it.example.com");

  const userRows = await db.select({ id: schema.users.id, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, user.id)).limit(1);
  assert.deepEqual(userRows[0], { id: user.id, email: "newuser@it.example.com" });

  const accountRows = await db
    .select({ id: schema.emailAccounts.id, address: schema.emailAccounts.address, userId: schema.emailAccounts.userId })
    .from(schema.emailAccounts)
    .where(eq(schema.emailAccounts.address, "newuser@it.example.com"))
    .limit(1);
  const account = accountRows[0];
  assert.ok(account);
  assert.equal(account.userId, user.id);

  const memberships = await db
    .select({ role: schema.mailAccountMemberships.role, userId: schema.mailAccountMemberships.userId })
    .from(schema.mailAccountMemberships)
    .where(eq(schema.mailAccountMemberships.accountId, account.id));
  assert.deepEqual(memberships, [{ role: "owner", userId: user.id }]);

  const orgMemberships = await db
    .select({ status: schema.organizationMemberships.status })
    .from(schema.organizationMemberships)
    .where(eq(schema.organizationMemberships.userId, user.id));
  assert.deepEqual(orgMemberships, [{ status: "active" }]);

  const mailboxCount = await db
    .select({ count: count() })
    .from(schema.mailboxes)
    .where(eq(schema.mailboxes.accountId, account.id));
  assert.equal(mailboxCount[0]?.count, 6);

  const accounts = await request("GET", "/mail/accounts", { userId: user.id });
  assert.equal(accounts.status, 200);
  assert.deepEqual((accounts.json.accounts as { address: string }[]).map((item) => item.address), ["newuser@it.example.com"]);
});

test("delegate access: a delegated account is readable", async (t) => {
  if (!dbAvailable) return t.skip("postgres unavailable");
  const boxes = await request("GET", `/mail/accounts/${communityAccountId}/mailboxes`, { userId: alyssaId });
  assert.equal(boxes.status, 200);
  const list = boxes.json.mailboxes as { role: string }[];
  assert.ok(list.some((m) => m.role === "inbox"));
});

test("read_only membership cannot send", async (t) => {
  if (!dbAvailable) return t.skip("postgres unavailable");
  const res = await request("POST", "/mail/send", {
    userId: alyssaId,
    body: { accountId: roAccountId, to: ["other@example.com"], subject: "nope", textBody: "x" },
  });
  assert.equal(res.status, 403);
});

test("send is queued, and duplicate clientRequestId replays idempotently", async (t) => {
  if (!dbAvailable) return t.skip("postgres unavailable");
  const body = { accountId: ramonAccountId, to: ["alyssa@it.example.com"], subject: "hi", textBody: "body", clientRequestId: "it-cr-1" };
  const first = await request("POST", "/mail/send", { userId: ramonId, body });
  assert.equal(first.status, 202);
  const second = await request("POST", "/mail/send", { userId: ramonId, body });
  assert.equal(second.status, 202);
  assert.equal(second.json.sendId, first.json.sendId);
  assert.equal(second.json.idempotentReplay, true);

  const matches = await db.select({ id: schema.outboundMessages.id }).from(schema.outboundMessages).where(eq(schema.outboundMessages.clientRequestId, "it-cr-1"));
  assert.equal(matches.length, 1);

  const status = await request("GET", `/mail/sends/${first.json.sendId}`, { userId: ramonId });
  assert.equal(status.status, 200);
  assert.equal(status.json.transportStatus, "queued");
  assert.ok(status.json.messageId);
});

test("concurrent claims never double-claim a job", async (t) => {
  if (!dbAvailable) return t.skip("postgres unavailable");
  await queue.claimDueJobs(100);
  const reserved: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const r = await queue.reserveSendOperation({
      accountId: ramonAccountId,
      fromAddress: "ramon@it.example.com",
      to: [`target${i}@example.com`],
      subject: `job-${i}`,
    });
    if (r.reserved) {
      reserved.push(r.id);
      await queue.finalizeSend(r.id, { engineMessageId: `claim-${i}`, engineThreadId: `claim-${i}` }, new Date(0));
    }
  }
  const [a, b] = await Promise.all([queue.claimDueJobs(10), queue.claimDueJobs(10)]);
  const claimed = [...a, ...b].map((c) => c.id);
  assert.equal(new Set(claimed).size, claimed.length, "a job was claimed twice");
  assert.equal(claimed.length, reserved.length);

  const rows = await db
    .select({ id: schema.outboundMessages.id, transportStatus: schema.outboundMessages.transportStatus })
    .from(schema.outboundMessages)
    .where(inArray(schema.outboundMessages.id, reserved));
  assert.ok(rows.every((r) => r.transportStatus === "sending"));

  await db.update(schema.outboundMessages).set({ transportStatus: "failed", failureCode: "test" }).where(inArray(schema.outboundMessages.id, reserved));
});

test("undo raced with claim: a claimed send cannot be cancelled", async (t) => {
  if (!dbAvailable) return t.skip("postgres unavailable");
  const body = { accountId: ramonAccountId, to: ["alyssa@it.example.com"], subject: "race", textBody: "x", clientRequestId: "it-race-1" };
  const send = await request("POST", "/mail/send", { userId: ramonId, body });
  const sendId = String(send.json.sendId);
  await queue.claimDueJobs(10);

  const cancel = await request("POST", `/mail/sends/${sendId}/cancel`, { userId: ramonId, body: {} });
  assert.equal(cancel.status, 400);
  assert.match(String(cancel.json.error ?? ""), /preparing or queued/);

  const status = await request("GET", `/mail/sends/${sendId}`, { userId: ramonId });
  assert.equal(status.json.transportStatus, "sending");
});

test("stale preparing rows reconcile to a single persisted Sent copy", async (t) => {
  if (!dbAvailable) return t.skip("postgres unavailable");
  const reserve = await queue.reserveSendOperation({
    accountId: ramonAccountId,
    fromAddress: "ramon@it.example.com",
    to: ["alyssa@it.example.com"],
    subject: "reconcile",
    textBody: "body",
    messageId: "<reconcile-1@it.example.com>",
  });
  assert.ok(reserve.reserved);
  await db
    .update(schema.outboundMessages)
    .set({ preparingStartedAt: sql`now() - interval '30 minutes'` })
    .where(eq(schema.outboundMessages.id, reserve.id));

  const reconcile = await import("./outbound/reconcile.js");
  const reconciled = await reconcile.reconcilePreparing(5);
  assert.equal(reconciled, 1);

  const row = (await db.select().from(schema.outboundMessages).where(eq(schema.outboundMessages.id, reserve.id)))[0];
  assert.equal(row?.transportStatus, "queued");
  assert.ok(row?.engineMessageId);

  const { getEngine } = await import("./engine/index.js");
  const found = await getEngine().findMessageByRfcMessageId(ramonAccountId, "<reconcile-1@it.example.com>");
  assert.ok(found);
  assert.equal(found.engineMessageId, row?.engineMessageId);
});

test("retry never duplicates the Sent copy", async (t) => {
  if (!dbAvailable) return t.skip("postgres unavailable");
  const body = { accountId: ramonAccountId, to: ["alyssa@it.example.com"], subject: "retry", textBody: "x", clientRequestId: "it-retry-1" };
  const send = await request("POST", "/mail/send", { userId: ramonId, body });
  const sendId = String(send.json.sendId);
  const messageId = String(send.json.messageId);

  await queue.markFailed(sendId, "test", "simulated failure");
  const retried = await request("POST", `/mail/sends/${sendId}/retry`, { userId: ramonId, body: { accountId: ramonAccountId } });
  assert.equal(retried.status, 202);

  await queue.claimDueJobs(10);
  const { getEngine } = await import("./engine/index.js");
  const found = await getEngine().findMessageByRfcMessageId(ramonAccountId, messageId);
  assert.ok(found);

  const events = await db
    .select({ n: count() })
    .from(schema.outboundDeliveryEvents)
    .where(eq(schema.outboundDeliveryEvents.outboundMessageId, sendId));
  assert.equal(events[0]?.n, 1);
});

test("webhook replay is idempotent per provider event", async (t) => {
  if (!dbAvailable) return t.skip("postgres unavailable");
  const body = { accountId: ramonAccountId, to: ["alyssa@it.example.com"], subject: "webhook", textBody: "x", clientRequestId: "it-wh-1" };
  const send = await request("POST", "/mail/send", { userId: ramonId, body });
  const sendId = String(send.json.sendId);
  const claimed = await queue.claimDueJobs(10);
  assert.ok(claimed.some((c) => c.id === sendId));
  await queue.markAccepted(sendId, "delivery-wh-1");

  const wh = { id: "evt-wh-1", type: "email.delivered", data: { id: "delivery-wh-1", to: ["alyssa@it.example.com"] } };
  const first = await request("POST", "/webhooks/delivery", { body: wh });
  assert.equal(first.status, 200);
  const second = await request("POST", "/webhooks/delivery", { body: wh });
  assert.equal(second.status, 200);

  const events = await db
    .select({ n: count() })
    .from(schema.outboundDeliveryEvents)
    .where(eq(schema.outboundDeliveryEvents.providerEventId, "evt-wh-1"));
  assert.equal(events[0]?.n, 1);
});

test("admin routes require authentication, explicit organization and active admin membership", async () => {
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.slug, "it-org"));
  assert.ok(org);
  for (const path of ["health", "stats", "outbound", "audit", "suppressions"]) {
    assert.equal((await request("GET", `/admin/${path}`)).status, 401);
    assert.equal((await request("GET", `/admin/${path}`, { userId: ramonId })).status, 400);
    assert.equal((await request("GET", `/admin/${path}?organizationId=${org.id}`, { userId: alyssaId })).status, 403);
    assert.equal((await request("GET", `/admin/${path}?organizationId=${org.id}`, { userId: ramonId })).status, 200);
  }
  const [other] = await db.insert(schema.organizations).values({ name: "Other", slug: "other" }).returning();
  assert.ok(other);
  assert.equal((await request("GET", `/admin/stats?organizationId=${other.id}`, { userId: ramonId })).status, 403);
  const created = await request("POST", "/admin/suppressions", { userId: ramonId, body: { organizationId: org.id, email: "blocked@example.com", reason: "complaint" } });
  assert.equal(created.status, 201);
  const path = `/admin/suppressions/${created.json.suppression.id}`;
  assert.equal((await request("DELETE", path, { userId: ramonId })).status, 400);
  assert.equal((await request("DELETE", `${path}?organizationId=${other.id}`, { userId: ramonId })).status, 403);
  assert.equal((await request("DELETE", `${path}?organizationId=${org.id}`, { userId: ramonId })).status, 200);
});

test("concurrent reservations with one clientRequestId create exactly one operation", async () => {
  const results = await Promise.all(Array.from({ length: 8 }, () => queue.reserveSendOperation({
    accountId: communityAccountId, fromAddress: "community@it.example.com", to: ["alyssa@it.example.com"], clientRequestId: "concurrent-reservation",
  })));
  assert.equal(results.filter((r) => r.reserved).length, 1);
  assert.equal(new Set(results.map((r) => r.id)).size, 1);
});

test("two-user acceptance: Alyssa sends as community and Ramon can inspect the shared send", async () => {
  const sent = await request("POST", "/mail/send", { userId: alyssaId, body: {
    accountId: communityAccountId, to: ["ramon@it.example.com"], subject: "Shared acceptance", textBody: "From Alyssa",
    attachments: [{ filename: "hello.txt", contentType: "text/plain", size: 5, content: "aGVsbG8=" }],
  } });
  assert.equal(sent.status, 202);
  const status = await request("GET", `/mail/sends/${sent.json.sendId}`, { userId: ramonId });
  assert.equal(status.status, 200);
  const job = await queue.loadJob(String(sent.json.sendId));
  assert.equal(job?.fromAddress, "community@it.example.com");
  assert.ok(job?.attachments?.[0]?.engineAttachmentId);
});

test("mcp auth: third-party tokens are audience, issuer, consent and account-status bound", async () => {
  await ensureMcpIdentityFixtures();
  await withEnv({ GSW_MCP_ENABLED: "true" }, async () => {
    const token = await mintMcpToken();
    const init = await mcpRpc(mcpRequest("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "integration", version: "1" } }), token);
    assert.equal(init.status, 200);
    assert.equal(init.json.result?.serverInfo?.name, "GSW Mail");
    assert.equal((await mcpRpc(mcpRequest("ping"))).status, 401);
    const rejected = [
      { label: "wrong audience", options: { audience: "https://other.example/mcp" } },
      { label: "wrong issuer", options: { issuer: "https://attacker.example/api/auth" } },
      { label: "missing openid scope", options: { scope: "mail.read mail.write" } },
      { label: "scope beyond consent", options: { scope: "openid mail.read mail.send" } },
      { label: "unknown subject mapping", options: { subject: "auth-unknown-user" } },
      { label: "unknown client", options: { clientId: "not-a-registered-client" } },
    ];
    for (const item of rejected) {
      const response = await mcpRpc(mcpRequest("ping"), await mintMcpToken(item.options));
      assert.equal(response.status, 401, item.label);
    }
    await db.update(schema.oauthClient).set({ disabled: true }).where(eq(schema.oauthClient.clientId, mcpClientId));
    assert.equal((await mcpRpc(mcpRequest("ping"), token)).status, 401, "disabled client must fail closed");
    await db.update(schema.oauthClient).set({ disabled: false }).where(eq(schema.oauthClient.clientId, mcpClientId));
    await db.update(schema.users).set({ status: "suspended" }).where(eq(schema.users.id, ramonId));
    assert.equal((await mcpRpc(mcpRequest("ping"), token)).status, 401, "suspended user must fail closed");
    await db.update(schema.users).set({ status: "active" }).where(eq(schema.users.id, ramonId));
  });
});

test("mcp discovery: identity, account isolation and capability status reflect live permissions", async () => {
  await ensureMcpIdentityFixtures();
  await withEnv({ GSW_MCP_ENABLED: "true" }, async () => {
    const token = await mintMcpToken();
    const who = await mcpToolCall("get_current_user", {}, token);
    assert.equal(who.status, 200);
    assert.equal(who.body.userId, ramonId);
    const accounts = await mcpToolCall("list_accounts", {}, token);
    assert.equal(accounts.status, 200);
    const listed = (accounts.body.accounts as Json[]).map((account) => account.accountId);
    assert.ok(listed.includes(ramonAccountId));
    assert.ok(listed.includes(communityAccountId));
    assert.ok(!listed.includes(alyssaAccountId), "another user's mailbox must not be discoverable");
    const catalog = await mcpToolCall("list_capabilities", { limit: 100 }, token);
    assert.equal(catalog.status, 200);
    assert.ok(Number(catalog.body.total) > 20);
    const capabilities = catalog.body.capabilities as Json[];
    const readTool = capabilities.find((entry) => entry.name === "mail__search");
    assert.equal(readTool?.status, "available_for_read");
    assert.deepEqual(readTool?.missingScopes, []);
    const writeTool = capabilities.find((entry) => entry.name === "mail__create_draft");
    assert.equal(writeTool?.status, "write_transport_disabled");
    const listing = await mcpRpc(mcpRequest("tools/list"), token);
    const listedTools = ((listing.json.result?.tools as Json[] | undefined) ?? []).map((tool) => tool.name);
    assert.ok(listedTools.includes("invoke_tool"));
    assert.ok(listedTools.includes("list_capabilities"));
    assert.ok(listedTools.includes("mail__search"));
    assert.ok(listedTools.includes("mail__create_draft"));
    assert.ok(listedTools.includes("mail__send_draft"));
    assert.ok(!listedTools.includes("prepare_action"), "draft preparation must stay disabled by default");
  });
});

test("mcp writes: owner-only write-test mode, request IDs and persisted approval are all mandatory", async () => {
  await ensureMcpIdentityFixtures();
  await ensureMcpWriteGrants();
  const token = await mintMcpToken();
  const draftArgs = { to: ["reviewer@it.example.com"], subject: "MCP gated draft", textBody: "Held behind write-test mode." };
  await withEnv({ GSW_MCP_ENABLED: "true" }, async () => {
    const disabled = await mcpToolCall("mail__create_draft", { ...draftArgs, accountId: ramonAccountId, requestId: randomUUID() }, token);
    assert.equal(disabled.body.error, "write_test_disabled");
  });
  await withEnv({
    GSW_MCP_ENABLED: "true",
    GSW_MCP_WRITE_TEST_ENABLED: "true",
    GSW_MCP_WRITE_TEST_USER_ID: alyssaId,
  }, async () => {
    const notOwner = await mcpToolCall("mail__create_draft", { ...draftArgs, accountId: ramonAccountId, requestId: randomUUID() }, token);
    assert.equal(notOwner.body.error, "write_test_disabled");
  });
  await withEnv({
    GSW_MCP_ENABLED: "true",
    GSW_MCP_WRITE_TEST_ENABLED: "true",
    GSW_MCP_WRITE_TEST_USER_ID: ramonId,
    GSW_MCP_PREPARE_ENABLED: undefined,
    GSW_MCP_REQUIRE_PERSISTED_APPROVAL: "true",
  }, async () => {
    const noRequestId = await mcpToolCall("mail__create_draft", { ...draftArgs, accountId: ramonAccountId }, token);
    assert.equal(noRequestId.body.error, "request_id_uuid_required");
    const noApproval = await mcpToolCall("mail__create_draft", { ...draftArgs, accountId: ramonAccountId, requestId: randomUUID() }, token);
    assert.equal(noApproval.body.error, "approval_required");
    const unexternal = await mcpToolCall("mail__send_draft", { accountId: ramonAccountId, draftId: randomUUID(), requestId: randomUUID(), confirmExternal: false }, token);
    assert.equal(unexternal.body.error, "permission_denied");
    const prepareDisabled = await mcpToolCall("prepare_action", { accountId: ramonAccountId, toolName: "mail.create_draft", arguments: draftArgs }, token);
    assert.equal(prepareDisabled.body.error, "preparation_disabled");
    const unconfirmedGrant = await mcpToolCall("grant_my_scopes", { accountId: ramonAccountId, scopes: ["mail.read"], confirmGrant: false }, token);
    assert.equal(unconfirmedGrant.body.error, "owner_grant_not_authorized");
    const beyondConsent = await mcpToolCall("grant_my_scopes", { accountId: ramonAccountId, scopes: ["mail.send"], confirmGrant: true }, token);
    assert.equal(beyondConsent.body.error, "scope_not_in_oauth_consent");
    const granted = await mcpToolCall("grant_my_scopes", { accountId: ramonAccountId, scopes: ["mail.read", "mail.write"], confirmGrant: true }, token);
    assert.equal(granted.status, 200);
    assert.deepEqual(granted.body.granted, ["mail.read", "mail.write"]);
    assert.equal(granted.body.status, "active");
  });
  await withEnv({
    GSW_MCP_ENABLED: "true",
    GSW_MCP_WRITE_TEST_ENABLED: "true",
    GSW_MCP_WRITE_TEST_USER_ID: ramonId,
    GSW_MCP_PREPARE_ENABLED: "true",
    GSW_MCP_REQUIRE_PERSISTED_APPROVAL: "true",
  }, async () => {
    const preparedWithoutGrantFlag = await mcpToolCall("prepare_action", { accountId: ramonAccountId, toolName: "mail.create_draft", arguments: draftArgs }, token);
    assert.ok(preparedWithoutGrantFlag.status === 200 && preparedWithoutGrantFlag.body.approvalId, "prepare_action records a first-party review request");
  });
});

test("mcp approval lifecycle: pending cannot execute, first-party review approves, replays and races never double-execute", async () => {
  await ensureMcpIdentityFixtures();
  await ensureMcpWriteGrants();
  const token = await mintMcpToken();
  const draftArgs = { to: ["reviewer@it.example.com"], subject: "Exact-content review draft", textBody: "Body that must match the reviewed digest." };
  const env = {
    GSW_MCP_ENABLED: "true",
    GSW_MCP_WRITE_TEST_ENABLED: "true",
    GSW_MCP_WRITE_TEST_USER_ID: ramonId,
    GSW_MCP_PREPARE_ENABLED: "true",
    GSW_MCP_REQUIRE_PERSISTED_APPROVAL: "true",
  };
  await withEnv(env, async () => {
    const first = await mcpToolCall("prepare_action", { accountId: ramonAccountId, toolName: "mail.create_draft", arguments: draftArgs }, token);
    assert.equal(first.status, 200);
    assert.equal(first.body.status, "pending");
    assert.equal(first.body.draftCreated, false);
    assert.equal(first.body.emailSent, false);
    assert.equal(first.body.executionEnabled, false);
    const approvalA = String(first.body.approvalId);

    const pendingExecute = await mcpToolCall("mail__create_draft", { ...draftArgs, accountId: ramonAccountId, requestId: randomUUID(), approvalId: approvalA }, token);
    assert.equal(pendingExecute.body.error, "approval_not_active");

    const preview = await request("GET", `/product/mcp/approvals/${approvalA}/draft`, { userId: ramonId });
    assert.equal(preview.status, 200);
    assert.equal(preview.json.draft.status, "pending");
    assert.deepEqual(preview.json.draft.arguments.to, draftArgs.to);
    const digest = String(preview.json.reviewedArgumentsDigest);
    assert.match(digest, /^[0-9a-f]{64}$/);

    const listing = await request("GET", "/product/mcp/approvals", { userId: ramonId });
    assert.equal(listing.status, 200);
    assert.ok((listing.json.approvals as Json[]).some((entry) => entry.id === approvalA && entry.status === "pending"));

    const bearerDecision = await decideMcpApproval({ approvalId: approvalA, decision: "approved", digest, authorization: `Bearer ${token}` });
    assert.equal(bearerDecision.status, 403);
    const noOrigin = await decideMcpApproval({ approvalId: approvalA, decision: "approved", digest });
    assert.equal(noOrigin.status, 403);
    const foreignOrigin = await decideMcpApproval({ approvalId: approvalA, decision: "approved", digest, origin: "https://evil.example" });
    assert.equal(foreignOrigin.status, 403);
    const wrongDigest = await decideMcpApproval({ approvalId: approvalA, decision: "approved", digest: "0".repeat(64), origin: "http://localhost:3000" });
    assert.equal(wrongDigest.status, 404);

    const decided = await decideMcpApproval({ approvalId: approvalA, decision: "approved", digest, origin: "http://localhost:3000" });
    assert.equal(decided.status, 200);
    assert.equal(decided.json.approval.status, "approved");

    const replayR1 = randomUUID();
    const executed = await mcpToolCall("mail__create_draft", { ...draftArgs, accountId: ramonAccountId, requestId: replayR1, approvalId: approvalA }, token);
    assert.equal(executed.isError, false);
    assert.ok(typeof executed.body.engineId === "string" && executed.body.engineId.length > 0);

    const replay = await mcpToolCall("mail__create_draft", { ...draftArgs, accountId: ramonAccountId, requestId: replayR1, approvalId: approvalA }, token);
    assert.equal(replay.body.status, "already_completed");
    assert.equal(replay.isError, false);

    const consumedAgain = await mcpToolCall("mail__create_draft", { ...draftArgs, accountId: ramonAccountId, requestId: randomUUID(), approvalId: approvalA }, token);
    assert.equal(consumedAgain.body.error, "approval_not_active");

    const second = await mcpToolCall("prepare_action", { accountId: ramonAccountId, toolName: "mail.create_draft", arguments: { ...draftArgs, subject: "Race review draft" } }, token);
    const approvalB = String(second.body.approvalId);
    const secondPreview = await request("GET", `/product/mcp/approvals/${approvalB}/draft`, { userId: ramonId });
    const secondDecided = await decideMcpApproval({
      approvalId: approvalB, decision: "approved", digest: String(secondPreview.json.reviewedArgumentsDigest), origin: "http://localhost:3000",
    });
    assert.equal(secondDecided.status, 200);

    const raceArgs = { ...draftArgs, subject: "Race review draft" };
    const racers = await Promise.all(Array.from({ length: 6 }, () =>
      mcpToolCall("mail__create_draft", { ...raceArgs, accountId: ramonAccountId, requestId: randomUUID(), approvalId: approvalB }, token)));
    const winners = racers.filter((result) => result.isError === false && typeof result.body.engineId === "string");
    assert.equal(winners.length, 1, "exactly one concurrent caller may consume an approved action");
    for (const loser of racers.filter((result) => !winners.includes(result))) {
      assert.equal(loser.body.error, "approval_not_active");
    }
  });
});

test("sessionless mailbox credential renews only an authorized first-party refresh token and fails closed", async (t) => {
  if (!dbAvailable) return t.skip("postgres unavailable");
  await ensureMcpIdentityFixtures();
  const mobileClientId = "gsw-mail-mobile";
  const refreshModule = await import("./auth/refreshStalwartMailboxToken.js");

  await db.insert(schema.oauthClient).values({
    id: mobileClientId, clientId: mobileClientId, disabled: false, name: "GSW Mail mobile",
    redirectUris: ["https://app.gsw.test/callback"], scopes: ["openid", "email", "offline_access"],
    grantTypes: ["authorization_code", "refresh_token"], public: true,
  }).onConflictDoNothing();
  const [originalAccount] = await db.select({ authSetupStatus: schema.emailAccounts.authSetupStatus })
    .from(schema.emailAccounts).where(eq(schema.emailAccounts.id, ramonAccountId)).limit(1);
  await db.update(schema.emailAccounts).set({ authSetupStatus: "ready" }).where(eq(schema.emailAccounts.id, ramonAccountId));

  const issuer = `${process.env.BETTER_AUTH_URL}/api/auth`;
  const sign = (overrides: { email?: string; subject?: string; scope?: string; audience?: string } = {}) =>
    new SignJWT({ email: overrides.email ?? "ramon@it.example.com", scope: overrides.scope ?? "openid email offline_access" })
      .setProtectedHeader({ alg: "ES256", kid: mcpJwksKid })
      .setIssuer(issuer)
      .setAudience(overrides.audience ?? "stalwart")
      .setSubject(overrides.subject ?? mcpAuthSubject)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(mcpTokenSigningKey!);

  let tokenBody: unknown = { access_token: "" };
  let tokenStatus = 200;
  const requestStub = (async () =>
    new Response(JSON.stringify(tokenBody), { status: tokenStatus, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

  const insertRefresh = (id: string, overrides: { expiresAt?: Date; revoked?: Date; scopes?: string[]; clientId?: string } = {}) =>
    db.insert(schema.oauthRefreshToken).values({
      id, token: `refresh-${id}`, clientId: overrides.clientId ?? mobileClientId, userId: mcpAuthSubject,
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 86_400_000), createdAt: new Date(),
      revoked: overrides.revoked ?? null, scopes: overrides.scopes ?? ["openid", "email", "offline_access"],
    }).onConflictDoNothing();

  const reset = async () => {
    refreshModule.clearRefreshedStalwartMailboxTokenCache(mcpAuthSubject, ramonAccountId);
    await db.delete(schema.oauthRefreshToken).where(eq(schema.oauthRefreshToken.clientId, mobileClientId));
    tokenStatus = 200;
  };
  const renew = () => refreshModule.refreshStoredStalwartMailboxToken({
    productUserId: ramonId, authUserId: mcpAuthSubject, accountId: ramonAccountId, request: requestStub,
  });

  try {
    await reset();
    assert.equal(await renew(), null, "no prior authorization fails closed");

    await reset();
    await insertRefresh("expired", { expiresAt: new Date(Date.now() - 1_000) });
    tokenBody = { access_token: await sign() };
    assert.equal(await renew(), null, "an expired refresh token is never renewed");

    await reset();
    await insertRefresh("revoked", { revoked: new Date() });
    assert.equal(await renew(), null, "a revoked refresh token is never renewed");

    await reset();
    await insertRefresh("failing", {});
    tokenStatus = 400;
    tokenBody = { error: "invalid_grant" };
    assert.equal(await renew(), null, "a rejected refresh never yields a credential");

    await reset();
    await insertRefresh("no-email-scope", { scopes: ["openid", "offline_access"] });
    tokenBody = { access_token: await sign() };
    assert.equal(await renew(), null, "a token without a mailbox scope is not a mailbox credential");

    await reset();
    await insertRefresh("wrong-mailbox", {});
    tokenBody = { access_token: await sign({ email: "other@it.example.com" }) };
    assert.equal(await renew(), null, "a credential for another mailbox is rejected");

    await reset();
    await insertRefresh("wrong-subject", {});
    tokenBody = { access_token: await sign({ subject: "auth-someone-else" }) };
    assert.equal(await renew(), null, "a credential for another principal is rejected");

    await reset();
    await insertRefresh("valid", {});
    const expected = await sign();
    tokenBody = { access_token: expected };
    assert.equal(await renew(), expected, "an authorized first-party credential is renewed");

    tokenBody = { access_token: await sign({ email: "other@it.example.com" }) };
    assert.equal(await renew(), expected, "a fresh credential is served from cache within its lifetime");
  } finally {
    await db.delete(schema.oauthRefreshToken).where(eq(schema.oauthRefreshToken.clientId, mobileClientId));
    await db.update(schema.emailAccounts)
      .set({ authSetupStatus: originalAccount?.authSetupStatus ?? "pending" })
      .where(eq(schema.emailAccounts.id, ramonAccountId));
  }
});

test("first-party mailbox-credential route requires a browser session and rejects an MCP bearer", async (t) => {
  if (!dbAvailable) return t.skip("postgres unavailable");
  const call = (headers: Record<string, string>) => fetch(`${baseUrl}/product/mcp/mailbox-credential`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-gsw-user-id": ramonId, ...headers },
    body: JSON.stringify({ accountId: ramonAccountId }),
  });

  assert.equal((await call({ cookie: "gsw.session_token=not-a-real-session" })).status, 403, "origin is required");
  assert.equal((await call({ cookie: "gsw.session_token=not-a-real-session", authorization: "Bearer anything", origin: "http://localhost:3000" })).status, 403, "an MCP bearer is never converted into a mailbox credential");
});
