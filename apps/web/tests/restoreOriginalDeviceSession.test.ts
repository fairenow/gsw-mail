import assert from "node:assert/strict";
import test from "node:test";
import { restoreOriginalDeviceSession } from "../src/lib/restoreOriginalDeviceSession.js";

const identity = (id: string) => ({ id, email: `${id}@example.com`, name: id, emailVerified: true });
const saved = (id: string) => ({ user: identity(id), session: { token: `${id}-session`, expiresAt: "2099-01-01" } });

test("restores only the original mailbox's saved session, even with an admin session listed first", async () => {
  const activated: string[] = [];
  await restoreOriginalDeviceSession("mailbox", {
    list: async () => [saved("admin"), saved("mailbox")],
    activate: async token => { activated.push(token); },
    current: async () => ({ user: identity("mailbox"), session: { expiresAt: "2099-01-01" } }),
  });
  assert.deepEqual(activated, ["mailbox-session"]);
});

test("expired original session never falls back to an administrator or another mailbox", async () => {
  await assert.rejects(restoreOriginalDeviceSession("mailbox", {
    list: async () => [saved("admin")],
    activate: async () => assert.fail("must not activate another account"),
    current: async () => assert.fail("must not query after missing session"),
  }), /expired/);
});

test("a racing account switch cannot be reported as a successful restoration", async () => {
  await assert.rejects(restoreOriginalDeviceSession("mailbox", {
    list: async () => [saved("mailbox")],
    activate: async () => undefined,
    current: async () => ({ user: identity("admin"), session: { expiresAt: "2099-01-01" } }),
  }), /Could not restore/);
});
