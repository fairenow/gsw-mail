import assert from "node:assert/strict";
import test from "node:test";
import { exerciseMcpMailboxLifecycle } from "./mcpMailboxLifecycle.js";

/** In-process contract tests. These use fake persistence and fake JMAP reads.
 * An actual OAuth + Postgres + Stalwart + MCP deployment test is a separate gate. */
test("successful first-party grant persists and permits later sessionless Inbox read", async () => {
  let persisted: string | null = null;
  let refreshCount = 0;
  const messages = await exerciseMcpMailboxLifecycle({
    establishFirstPartyGrant: async () => { persisted = "first-party-refresh-grant"; },
    loadPersistedGrant: async () => persisted,
    refreshAndVerify: async grant => {
      assert.equal(grant, "first-party-refresh-grant");
      refreshCount++;
      return "signed-mailbox-access-token";
    },
    readInboxViaSessionlessMcp: async token => {
      assert.equal(token, "signed-mailbox-access-token");
      return ["message-1", "message-2"];
    },
  });
  assert.deepEqual(messages, ["message-1", "message-2"]);
  assert.equal(refreshCount, 1);
});

test("missing persisted grant prevents any refresh or Inbox read", async () => {
  let reachedMailbox = false;
  await assert.rejects(exerciseMcpMailboxLifecycle({
    establishFirstPartyGrant: async () => {},
    loadPersistedGrant: async () => null,
    refreshAndVerify: async () => { throw new Error("must not refresh"); },
    readInboxViaSessionlessMcp: async () => { reachedMailbox = true; return []; },
  }), /mailbox_refresh_credential_not_persisted/);
  assert.equal(reachedMailbox, false);
});

test("failed grant refresh cannot fall through to mailbox reads", async () => {
  let reachedMailbox = false;
  await assert.rejects(exerciseMcpMailboxLifecycle({
    establishFirstPartyGrant: async () => {},
    loadPersistedGrant: async () => "expired-grant",
    refreshAndVerify: async () => { throw new Error("invalid_grant"); },
    readInboxViaSessionlessMcp: async () => { reachedMailbox = true; return []; },
  }), /invalid_grant/);
  assert.equal(reachedMailbox, false);
});

test("unusable access tokens fail closed before Inbox access", async () => {
  let reachedMailbox = false;
  await assert.rejects(exerciseMcpMailboxLifecycle({
    establishFirstPartyGrant: async () => {},
    loadPersistedGrant: async () => "grant",
    refreshAndVerify: async () => "",
    readInboxViaSessionlessMcp: async () => { reachedMailbox = true; return []; },
  }), /mailbox_refresh_credential_unusable/);
  assert.equal(reachedMailbox, false);
});
