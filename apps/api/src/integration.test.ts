import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { count, eq, inArray, sql } from "drizzle-orm";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://gsw_mail:gsw_mail@localhost:5432/gsw_mail_test";
if (new URL(process.env.DATABASE_URL).pathname !== "/gsw_mail_test") throw new Error("Integration tests require gsw_mail_test");
process.env.NODE_ENV = "test";
process.env.DELIVERY_WEBHOOK_SECRET = "";
process.env.SEND_DELAY_SECONDS = "0";
process.env.OUTBOUND_RELAY = "null";
process.env.MAIL_ENGINE = "demo";
process.env.DEV_USER_ID = "";

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

before(async () => {
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
