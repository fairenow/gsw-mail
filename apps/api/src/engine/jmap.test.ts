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

test("reports JMAP session success without token data", async () => {
  const events: [string, number | undefined][] = [];
  const client = new JmapClient({
    baseUrl: "https://mx1.test",
    token: "user-token",
    sessionTtlMs: 60_000,
    fetchImpl: async () => Response.json(session),
    onSessionEvent: (event, status) => events.push([event, status]),
  });

  await client.session();

  assert.deepEqual(events, [["start", undefined], ["success", undefined]]);
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

test("reports JMAP session rejection status", async () => {
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
