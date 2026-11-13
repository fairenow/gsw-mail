import { strict as assert } from "node:assert";
import { test } from "node:test";
import { JmapClient } from "./jmap.js";

const session = {
  apiUrl: "https://mx1.test/jmap",
  uploadUrl: "https://mx1.test/upload",
  downloadUrl: "https://mx1.test/download",
  blobUrl: "https://mx1.test/download",
  eventSourceUrl: null,
  accounts: {},
  primaryAccounts: {},
};

test("uses Stalwart's /jmap/session endpoint first", async () => {
  const requests: string[] = [];
  const events: [string, number | undefined][] = [];
  const client = new JmapClient({
    baseUrl: "https://mx1.test",
    token: "user-token",
    sessionTtlMs: 60_000,
    fetchImpl: async (input) => {
      requests.push(String(input));
      return Response.json(session);
    },
    onSessionEvent: (event, status) => events.push([event, status]),
  });

  await client.session();

  assert.deepEqual(requests, ["https://mx1.test/jmap/session"]);
  assert.deepEqual(events, [["start", undefined], ["success", undefined]]);
});

test("falls back to /.well-known/jmap when /jmap/session is unavailable", async () => {
  const requests: string[] = [];
  const client = new JmapClient({
    baseUrl: "https://mx1.test",
    token: "user-token",
    sessionTtlMs: 60_000,
    fetchImpl: async (input) => {
      requests.push(String(input));
      if (requests.length === 1) return new Response("missing", { status: 404 });
      return Response.json(session);
    },
  });

  await client.session();

  assert.deepEqual(requests, ["https://mx1.test/jmap/session", "https://mx1.test/.well-known/jmap"]);
});

test("uses an explicit authorization header for background JMAP sessions", async () => {
  let authorization: string | null = null;
  const client = new JmapClient({
    baseUrl: "https://mx1.test",
    authorization: "Basic dGFyZ2V0JXNlcnZpY2U6c2VjcmV0",
    sessionTtlMs: 60_000,
    fetchImpl: async (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization");
      return Response.json(session);
    },
  });

  await client.session();

  assert.equal(authorization, "Basic dGFyZ2V0JXNlcnZpY2U6c2VjcmV0");
});

test("reports JMAP session rejection status after both session endpoints fail", async () => {
  const events: [string, number | undefined][] = [];
  const client = new JmapClient({
    baseUrl: "https://mx1.test",
    token: "user-token",
    sessionTtlMs: 60_000,
    fetchImpl: async () => new Response("Unauthorized", { status: 401 }),
    onSessionEvent: (event, status) => events.push([event, status]),
  });

  await assert.rejects(client.session(), (error: { type?: string }) => error.type === "mail_identity_rejected");
  assert.deepEqual(events, [["start", undefined], ["rejected", 401]]);
});

test("coalesces concurrent JMAP session discovery and reuses the cached session", async () => {
  let requests = 0;
  const client = new JmapClient({
    baseUrl: "https://mx1.test",
    token: "user-token",
    sessionTtlMs: 60_000,
    fetchImpl: async () => {
      requests++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return Response.json(session);
    },
  });
  const [a, b, c] = await Promise.all([client.session(), client.session(), client.session()]);
  assert.equal(a, b);
  assert.equal(b, c);
  assert.equal(requests, 1, "only one discovery request for three concurrent callers");
  await client.session();
  assert.equal(requests, 1, "fresh cached session does not refetch");
});

test("retries a failed session discovery instead of caching a rejected in-flight request", async () => {
  let requests = 0;
  const client = new JmapClient({
    baseUrl: "https://mx1.test",
    token: "user-token",
    sessionTtlMs: 60_000,
    fetchImpl: async () => {
      requests++;
      if (requests <= 2) return new Response("unavailable", { status: 503 });
      return Response.json(session);
    },
  });
  await assert.rejects(Promise.all([client.session(), client.session()]));
  assert.equal(requests, 2, "failed discovery checks both supported endpoints once");
  await client.session();
  assert.equal(requests, 3, "next attempt recovers after failed discovery");
});
