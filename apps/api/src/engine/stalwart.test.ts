import { strict as assert } from "node:assert";
import { test } from "node:test";
import { StalwartEngine } from "./stalwart.js";
import type { SendDraftInput } from "./types.js";

interface EmailRecord {
  id: string;
  threadId: string;
  mailboxIds: Record<string, boolean>;
  keywords: Record<string, boolean>;
  receivedAt: string;
  sentAt?: string;
  subject: string;
  from?: { email: string; name?: string }[];
  to?: { email: string }[];
  cc?: { email: string }[];
  bcc?: { email: string }[];
  replyTo?: { email: string }[];
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  size: number;
  hasAttachment: boolean;
  attachments?: { blobId: string; name: string; type: string; size: number }[];
  textBody?: { partId: string; type: string }[];
  htmlBody?: { partId: string; type: string }[];
  bodyValues?: Record<string, { value: string }>;
}

const BASE = "https://mx1.test";
const ACCOUNTS: Record<string, { name: string }> = {
  "acct-ramon": { name: "ramon@gs.com" },
  "acct-test": { name: "test@team.guidedstepswellness.com" },
};

const MAILBOXES = [
  { id: "mbox-inbox", name: "Inbox", role: "inbox", sortOrder: 0 },
  { id: "mbox-custom", name: "Receipts", role: null, sortOrder: 1 },
  { id: "mbox-unknown", name: "Quarantine", role: "quarantine", sortOrder: 2 },
  { id: "mbox-archive", name: "Archive", role: "archive", sortOrder: 3 },
  { id: "mbox-drafts", name: "Drafts", role: "drafts", sortOrder: 4 },
  { id: "mbox-sent", name: "Sent", role: "sent", sortOrder: 5 },
  { id: "mbox-junk", name: "Junk", role: "junk", sortOrder: 6 },
  { id: "mbox-trash", name: "Trash", role: "trash", sortOrder: 7 },
];

const emails = new Map<string, EmailRecord>();
let seq = 0;

const full: EmailRecord[] = [
  {
    id: "e1",
    threadId: "t1",
    mailboxIds: { "mbox-inbox": true },
    keywords: {},
    receivedAt: "2026-01-02T03:04:05Z",
    subject: "Welcome",
    from: [{ email: "boss@other.com", name: "Boss" }],
    to: [{ email: "ramon@gs.com" }],
    size: 1200,
    hasAttachment: false,
    textBody: [{ partId: "p1", type: "text/plain" }],
    bodyValues: { p1: { value: "hello there" } },
    messageId: "<m1@other.com>",
  },
  {
    id: "e2",
    threadId: "t1",
    mailboxIds: { "mbox-inbox": true },
    keywords: { $seen: true },
    receivedAt: "2026-01-03T03:04:05Z",
    subject: "Re: Welcome",
    from: [{ email: "ramon@gs.com" }],
    to: [{ email: "boss@other.com" }],
    inReplyTo: "<m1@other.com>",
    references: "<m1@other.com>",
    size: 900,
    hasAttachment: false,
    textBody: [{ partId: "p1", type: "text/plain" }],
    bodyValues: { p1: { value: "back at you" } },
    messageId: "<m2@gs.com>",
  },
  {
    id: "e3",
    threadId: "t3",
    mailboxIds: { "mbox-inbox": true },
    keywords: {},
    receivedAt: "2026-01-04T03:04:05Z",
    subject: "Invoice with file",
    from: [{ email: "billing@vendor.net" }],
    to: [{ email: "ramon@gs.com" }],
    size: 5000,
    hasAttachment: true,
    attachments: [{ blobId: "att-one", name: "invoice.pdf", type: "application/pdf", size: 4000 }],
    textBody: [{ partId: "p1", type: "text/plain" }],
    bodyValues: { p1: { value: "See the attached invoice." } },
    messageId: "<m3@vendor.net>",
  },
];

mapload(full);

function mapload(records: EmailRecord[]) {
  for (const r of records) emails.set(r.id, r);
}

const requestLog: { url: string; method: string; body?: string }[] = [];
const capturedAuth = new Map<number, string>();

const deref = (root: unknown, path: string): unknown[] => {
  const steps = path.replace(/^\//, "").split("/").filter((s) => s.length > 0);
  const resolve = (node: unknown, i: number): unknown[] => {
    const step = steps[i];
    if (step === undefined) return [node];
    if (step === "*") {
      if (!Array.isArray(node)) return [];
      return node.flatMap((child) => resolve(child, i + 1));
    }
    if (node === null || typeof node !== "object") return [];
    return resolve((node as Record<string, unknown>)[step], i + 1);
  };
  return resolve(root, 0);
};

const mailstore = (methodCalls: { name: string; args: Record<string, unknown>; id: string }[]) => {
  const responses: [string, Record<string, unknown>, string][] = [];
  for (const call of methodCalls) {
    const args = call.args;
    if (call.name === "Mailbox/get") {
      responses.push([
        "Mailbox/get",
        {
          accountId: args.accountId,
          list: (args.ids ?? null)
            ? MAILBOXES.filter((m) => (args.ids as string[]).includes(m.id))
            : MAILBOXES,
        },
        call.id,
      ]);
    } else if (call.name === "Email/query") {
      const filter = (args.filter ?? {}) as Record<string, unknown>;
      let ids = [...emails.values()] as EmailRecord[];
      const mailboxId = typeof filter.inMailbox === "string" ? (filter.inMailbox as string) : null;
      if (mailboxId) ids = ids.filter((e) => e.mailboxIds[mailboxId]);
      const threadId = typeof filter.inThread === "string" ? (filter.inThread as string) : null;
      if (threadId) ids = ids.filter((e) => e.threadId === threadId);
      if (typeof filter.text === "string") {
        const needle = (filter.text as string).toLowerCase();
        ids = ids.filter((e) => `${e.subject} ${e.bodyValues?.p1?.value ?? ""}`.toLowerCase().includes(needle));
      }
      if (typeof filter.header === "object" && filter.header) {
        const header = filter.header as Record<string, string[]>;
        if (header["Message-ID"]) {
          const wanted = header["Message-ID"];
          ids = ids.filter((e) => e.messageId !== undefined && wanted.includes(e.messageId));
        }
      }
      ids = ids.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
      const position = (args.position as number) ?? 0;
      const limit = (args.limit as number) ?? 50;
      responses.push(["Email/query", { accountId: args.accountId, ids: ids.slice(position, position + limit).map((e) => e.id) }, call.id]);
    } else if (call.name === "Email/get") {
      const ref = (args["#ids"] ?? null) as { resultOf?: string; name?: string; path?: string } | null;
      let wanted: string[] = [];
      if (ref) {
        const refResponse = responses.find((r) => r[0] === ref.name && r[2] === ref.resultOf);
        if (!refResponse) {
          responses.push([
            "error",
            { type: "invalidResultReference", description: `Id reference "${ref.resultOf}" does not exist or is invalid.` },
            call.id,
          ]);
          continue;
        }
        const resolved = deref(refResponse[1], ref.path ?? "");
        const value = (ref.path ?? "").includes("*") ? resolved.flat() : resolved[0];
        wanted = Array.isArray(value) ? (value as unknown[]).filter((x): x is string => typeof x === "string") : [];
      } else {
        const ids = (args.ids as string[]) ?? [];
        if (ids.some((raw) => raw.startsWith("#"))) {
          responses.push([
            "error",
            { type: "invalidResultReference", description: `Id reference "${ids.find((r) => r.startsWith("#"))}" does not exist or is invalid.` },
            call.id,
          ]);
          continue;
        }
        wanted = ids;
      }
      responses.push([
        "Email/get",
        {
          accountId: args.accountId,
          list: wanted.map((id) => emails.get(id)).filter((e): e is EmailRecord => Boolean(e)).map((e) => ({ ...e })),
        },
        call.id,
      ]);
    } else if (call.name === "Email/set") {
      const created = (args.create ?? {}) as Record<string, Record<string, unknown>>;
      const update = (args.update ?? {}) as Record<string, Record<string, unknown>>;
      const createdIds: Record<string, unknown> = {};
      for (const [clientId, obj] of Object.entries(created)) {
        seq += 1;
        const id = `e-created-${seq}`;
        const mailboxIds = (obj.mailboxIds as Record<string, boolean>) ?? {};
        const record: EmailRecord = {
          id,
          threadId: `t-created-${seq}`,
          mailboxIds,
          keywords: (obj.keywords as Record<string, boolean>) ?? { $seen: false },
          receivedAt: new Date().toISOString(),
          subject: (obj.subject as string) ?? "",
          from: obj.from as { email: string }[],
          to: obj.to as { email: string }[],
          cc: (obj.cc as { email: string }[]) ?? [],
          bcc: (obj.bcc as { email: string }[]) ?? [],
          ...(typeof obj.messageId === "string" ? { messageId: obj.messageId as string } : {}),
          size: 10,
          hasAttachment: Array.isArray(obj.attachments) && (obj.attachments as unknown[]).length > 0,
          ...(obj.attachments ? { attachments: obj.attachments as NonNullable<EmailRecord["attachments"]> } : {}),
          ...(obj.textBody ? { textBody: obj.textBody as NonNullable<EmailRecord["textBody"]> } : {}),
          ...(obj.htmlBody ? { htmlBody: obj.htmlBody as NonNullable<EmailRecord["htmlBody"]> } : {}),
          ...(obj.bodyValues ? { bodyValues: obj.bodyValues as NonNullable<EmailRecord["bodyValues"]> } : {}),
        };
        emails.set(id, record);
        createdIds[clientId] = { id: record.id, threadId: record.threadId };
      }
      for (const [id, patch] of Object.entries(update)) {
        const e = emails.get(id);
        if (!e) continue;
        for (const [path, value] of Object.entries(patch)) {
          if (!path.startsWith("/keywords/")) continue;
          const keyword = path.slice("/keywords/".length);
          if (value === null) {
            if (patch.mailboxIds) delete e.keywords[keyword];
            else e.keywords[keyword] = false;
          }
          else e.keywords[keyword] = Boolean(value);
        }
        if (patch.keywords) e.keywords = { ...(e.keywords ?? {}), ...(patch.keywords as Record<string, boolean>) };
        if (patch.mailboxIds) {
          const previous = Object.keys(e.mailboxIds ?? {});
          e.mailboxIds = patch.mailboxIds as Record<string, boolean>;
          const removed = previous.some((mb) => !(e.mailboxIds as Record<string, boolean>)[mb]);
          if (removed) {
            const toRemove = (patch.onDestroyRemoveKeywords as Record<string, boolean> | undefined) ?? {};
            for (const k of Object.keys(toRemove)) delete e.keywords[k];
          }
        }
      }
      responses.push(["Email/set", { accountId: args.accountId, created: createdIds, updated: Object.keys(update) }, call.id]);
    } else if (call.name === "Thread/get") {
      const ids = (args.ids as string[]) ?? [];
      const list = ids
        .map((id) => ({ id, emailIds: [...emails.values()].filter((e) => e.threadId === id).map((e) => e.id) }))
        .filter((t) => t.emailIds.length > 0);
      responses.push(["Thread/get", { accountId: args.accountId, list }, call.id]);
    } else {
      responses.push([call.name, {}, call.id]);
    }
  }
  return responses;
};

const blobs = new Map<string, Buffer>();

const findAccount = (id: string) => (ACCOUNTS[id] ? id : Object.entries(ACCOUNTS).find(([, acc]) => acc.name === id)?.[0]);

function makeFetch() {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const index = requestLog.length;
    requestLog.push({
      url,
      method,
      ...(init?.body !== undefined && init?.body !== null ? { body: String(init.body) } : {}),
    });
    const headers = init?.headers as { Authorization?: string; authorization?: string } | Headers | undefined;
    const auth = headers instanceof Headers ? (headers.get("Authorization") ?? undefined) : (headers?.Authorization ?? headers?.authorization);
    if (auth) capturedAuth.set(index, auth);
    if (url.endsWith("/.well-known/jmap")) {
      return Response.json({
        apiUrl: `${BASE}/jmap`,
        uploadUrl: `${BASE}/jmap/upload/{accountId}`,
        downloadUrl: `${BASE}/jmap/download/{accountId}`,
        blobUrl: `${BASE}/jmap/download/{accountId}/{blobId}`,
        eventSourceUrl: null,
        accounts: ACCOUNTS,
        primaryAccounts: {},
      });
    }
    if (url.endsWith("/jmap")) {
      const payload = JSON.parse(String(init?.body)) as { methodCalls: [string, Record<string, unknown>, string][] };
      const responses = mailstore(payload.methodCalls.map(([name, args, id]) => ({ name, args, id })));
      return Response.json({ methodResponses: responses, sessionState: "s" });
    }
    const upload = url.match(/\/jmap\/upload\/(.+)$/);
    if (upload && method === "POST") {
      const accountId = findAccount(decodeURIComponent(upload[1]!))!;
      const body = init?.body as unknown;
      const content = Buffer.isBuffer(body) ? body : Buffer.from(new Uint8Array(body as ArrayBuffer));
      seq += 1;
      const blobId = `blob-${seq}`;
      blobs.set(blobId, content);
      return Response.json({ accountId, blobId, size: content.byteLength, type: "application/pdf" });
    }
    const download = url.match(/\/jmap\/download\/([^/]+)\/([^/]+)(?:\/([^/?]+))?/);
    if (download) {
      const blobId = decodeURIComponent(download[2]!);
      const content = blobs.get(blobId);
      if (!content) return new Response("missing", { status: 404 });
      return new Response(content, { headers: { "Content-Type": "application/pdf" } });
    }
    return new Response("not found", { status: 404 });
  };
}

const engine = new StalwartEngine({
  jmapUrl: BASE,
  accessToken: "user-token",
  sessionTtlMs: 10_000,
  fetchImpl: makeFetch(),
});

const mailboxEngine = new StalwartEngine({
  jmapUrl: BASE,
  serviceUsername: "test@team.guidedstepswellness.com",
  servicePassword: "mailbox-pass",
  sessionTtlMs: 10_000,
  fetchImpl: makeFetch(),
});

test("service credentials are sent as Basic auth", async () => {
  requestLog.length = 0;
  capturedAuth.clear();
  await mailboxEngine.listMailboxes("test@team.guidedstepswellness.com");
  const expected = `Basic ${Buffer.from("test@team.guidedstepswellness.com:mailbox-pass", "utf8").toString("base64")}`;
  assert.ok(requestLog.length >= 2, "session and jmap requests were made");
  for (const index of requestLog.keys()) {
    assert.equal(capturedAuth.get(index), expected, `request ${index} used Basic mailbox auth`);
  }
});

test("request access tokens are sent as Bearer auth", async () => {
  requestLog.length = 0;
  capturedAuth.clear();
  await engine.listMailboxes("ramon@gs.com");
  assert.ok(requestLog.length >= 2, "session and jmap requests were made");
  for (const index of requestLog.keys()) {
    assert.equal(capturedAuth.get(index), "Bearer user-token", `request ${index} used request bearer auth`);
  }
});

test("listMailboxes maps roles", async () => {
  const boxes = await engine.listMailboxes("ramon@gs.com");
  assert.equal(boxes.length, MAILBOXES.length);
  assert.equal(boxes.find((b) => b.role === "inbox")?.engineName, "Inbox");
  assert.equal(boxes.find((b) => b.role === "sent")?.engineId, "mbox-sent");
  assert.equal(boxes.find((b) => b.role === "spam")?.engineName, "Junk");
});

test("listMailboxes does not classify custom folders as archive", async () => {
  const boxes = await engine.listMailboxes("ramon@gs.com");
  assert.equal(boxes.find((b) => b.engineId === "mbox-archive")?.role, "archive");
  assert.equal(boxes.find((b) => b.engineId === "mbox-custom")?.role, null);
  assert.equal(boxes.find((b) => b.engineId === "mbox-unknown")?.role, null);
});

test("listMessages returns summaries with names", async () => {
  requestLog.length = 0;
  const rows = await engine.listMessages("ramon@gs.com", { mailbox: "Inbox", limit: 50 });
  assert.equal(rows.length, 3);
  assert.equal(rows[0]?.mailbox, "Inbox");
  assert.equal(rows[0]?.threadId, "t3");
  assert.equal(rows[0]?.subject, "Invoice with file");
  const seen = rows.find((r) => r.engineId === "e2");
  assert.equal(seen?.read, true);
  const jmapCall = requestLog.find((l) => l.url.endsWith("/jmap"));
  const body = JSON.parse(jmapCall!.body!) as { methodCalls: [string, Record<string, unknown>, string][] };
  const emailGet = body.methodCalls.find(([name]) => name === "Email/get");
  assert.deepEqual(emailGet![1]["#ids"], { resultOf: "q1", name: "Email/query", path: "/ids" });
  assert.equal(emailGet![1].ids, undefined);
});

test("getMessage returns bodies, attachments, and headers", async () => {
  const msg = await engine.getMessage("ramon@gs.com", "e3");
  assert.ok(msg);
  assert.equal(msg.subject, "Invoice with file");
  assert.equal(msg.hasAttachments, true);
  assert.equal(msg.attachments.length, 1);
  assert.equal(msg.attachments[0]?.filename, "invoice.pdf");
  assert.equal(msg.attachments[0]?.engineId, "att-one");
  assert.equal(msg.textBody, "See the attached invoice.");
  assert.equal(msg.headers["Message-ID"], "<m3@vendor.net>");
  assert.match(msg.date.toISOString(), /2026-01-04/);
});

test("getThread returns all thread emails", async () => {
  requestLog.length = 0;
  const rows = await engine.getThread("ramon@gs.com", "t1");
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.threadId === "t1"));
  const jmapCall = requestLog.find((l) => l.url.endsWith("/jmap"));
  const body = JSON.parse(jmapCall!.body!) as { methodCalls: [string, Record<string, unknown>, string][] };
  const emailGet = body.methodCalls.find(([name]) => name === "Email/get");
  assert.deepEqual(emailGet![1]["#ids"], { resultOf: "t1", name: "Thread/get", path: "/list/*/emailIds" });
  assert.equal(emailGet![1].ids, undefined);
});

test("setSeen and setFlagged update keywords", async () => {
  await engine.setSeen("ramon@gs.com", ["e1"], true);
  assert.equal(emails.get("e1")?.keywords["$seen"], true);
  await engine.setFlagged("ramon@gs.com", ["e1"], true);
  assert.equal(emails.get("e1")?.keywords["$flagged"], true);
  await engine.setSeen("ramon@gs.com", ["e1"], false);
  assert.equal(emails.get("e1")?.keywords["$seen"], false);
});

test("move relocates and clears keywords", async () => {
  await engine.move("ramon@gs.com", ["e1"], "Trash");
  assert.deepEqual(emails.get("e1")?.mailboxIds, { "mbox-trash": true });
  assert.equal(emails.get("e1")?.keywords["$flagged"], undefined);
});

test("move to Archive resolves the actual archive mailbox", async () => {
  await engine.move("ramon@gs.com", ["e3"], "archive");
  assert.deepEqual(emails.get("e3")?.mailboxIds, { "mbox-archive": true });
});

test("saveDraft creates email in Drafts", async () => {
  const draft: SendDraftInput = {
    from: "ramon@gs.com",
    to: ["alyssa@gs.com"],
    subject: "Draft subject",
    textBody: "body",
  };
  const id = await engine.saveDraft("ramon@gs.com", draft);
  const created = emails.get(id);
  assert.ok(created);
  assert.deepEqual(created.mailboxIds, { "mbox-drafts": true });
});

test("saveSent uploads attachments and creates in Sent", async () => {
  const content = Buffer.from("pdf-bytes").toString("base64");
  const draft: SendDraftInput = {
    from: "ramon@gs.com",
    to: ["alyssa@gs.com"],
    subject: "With attachment",
    textBody: "See pdf",
    messageId: "<send-1@gs.com>",
    inReplyTo: "<previous@gs.com>",
    references: "<previous@gs.com>",
    attachments: [
      { filename: "report.pdf", contentType: "application/pdf", size: 9, content },
    ],
  };
  const result = await engine.saveSent("ramon@gs.com", draft);
  const created = emails.get(result.engineMessageId);
  assert.ok(created);
  assert.deepEqual(created.mailboxIds, { "mbox-sent": true });
  assert.equal(created.keywords["$seen"], true);
  assert.equal(created.hasAttachment, true);
  assert.equal(created.attachments?.[0]?.name, "report.pdf");
  assert.equal(result.attachments?.length, 1);
  assert.ok(result.attachments?.[0]?.engineId.startsWith("blob-"));
  const bodyKey = created.textBody?.[0]?.partId ?? "p1";
  assert.equal(created.bodyValues?.[bodyKey]?.value, "See pdf");
  const uploadRequest = requestLog.find((l) => l.url.includes("/jmap/upload/"));
  assert.ok(uploadRequest, "upload request was made");
  const jmapRequests = requestLog.filter((l) => l.url.endsWith("/jmap"));
  const jmapRequest = jmapRequests[jmapRequests.length - 1];
  const jmapBody = JSON.parse(jmapRequest!.body!) as { methodCalls: [string, Record<string, unknown>, string][] };
  const emailSet = jmapBody.methodCalls.find(([name]) => name === "Email/set");
  const create = (emailSet![1].create as Record<string, Record<string, unknown>>)["c1"]!;
  assert.deepEqual(create.messageId, ["<send-1@gs.com>"]);
  assert.deepEqual(create.inReplyTo, ["<previous@gs.com>"]);
  assert.deepEqual(create.references, ["<previous@gs.com>"]);
  assert.equal(create.header, undefined);
});

test("saveSent without content throws", async () => {
  const draft: SendDraftInput = {
    from: "ramon@gs.com",
    to: ["alyssa@gs.com"],
    subject: "nope",
    attachments: [{ filename: "a.bin", contentType: "application/octet-stream", size: 1 }],
  };
  await assert.rejects(() => engine.saveSent("ramon@gs.com", draft), /missing base64 content/);
});

test("findMessageByRfcMessageId locates by header filter", async () => {
  const hit = await engine.findMessageByRfcMessageId("ramon@gs.com", "<m3@vendor.net>");
  assert.deepEqual(hit, { engineMessageId: "e3", engineThreadId: "t3" });
});

test("listMessages rejects a pseudo reference instead of the standard result reference", async () => {
  requestLog.length = 0;
  await engine.listMessages("ramon@gs.com", { mailbox: "Inbox", limit: 50 });
  const jmapCall = requestLog.find((l) => l.url.endsWith("/jmap"));
  const body = JSON.parse(jmapCall!.body!) as { methodCalls: [string, Record<string, unknown>, string][] };
  const emailGet = body.methodCalls.find(([name]) => name === "Email/get");
  assert.ok(emailGet, "engine sent Email/get");
  const argIds = (emailGet![1].ids as string[] | undefined) ?? [];
  assert.ok(argIds.every((raw) => !raw.startsWith("#")), "no # pseudo-ids in Email/get ids");
  assert.ok(emailGet![1]["#ids"], "uses the object result reference form");
});

test("search with text filter", async () => {
  const rows = await engine.search("ramon@gs.com", "invoice");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.engineId, "e3");
});

test("getAttachment downloads blob bytes", async () => {
  blobs.set("att-one", Buffer.from("report-bytes"));
  const body = await engine.getAttachment("ramon@gs.com", "att-one");
  assert.ok(body);
  assert.equal(body.content.toString(), "report-bytes");
  assert.equal(body.contentType, "application/pdf");
});

test("getAttachment returns null on 404", async () => {
  const body = await engine.getAttachment("ramon@gs.com", "missing");
  assert.equal(body, null);
});

test("status is ok when session is reachable", async () => {
  const status = await engine.status();
  assert.equal(status.ok, true);
});

test("unknown account fails with typed error", async () => {
  await assert.rejects(() => engine.listMailboxes("ghost@gs.com"), (err: Error) => {
    assert.match(err.message, /no JMAP account found/);
    return true;
  });
});
