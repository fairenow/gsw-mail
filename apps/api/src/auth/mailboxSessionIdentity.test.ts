import assert from "node:assert/strict";
import test from "node:test";
import { assertMailboxSessionIdentity } from "./mailboxSessionIdentity.js";

test("browser mailbox OAuth allows only the matching authenticated principal", () => {
  assert.doesNotThrow(() => assertMailboxSessionIdentity("user-a", "user-a"));
});
test("browser mailbox OAuth rejects missing or different sessions", () => {
  for (const session of [null, "user-b"]) {
    assert.throws(() => assertMailboxSessionIdentity("user-a", session), /mailbox_session_identity_mismatch/);
  }
  assert.throws(() => assertMailboxSessionIdentity("", "user-a"), /mailbox_session_identity_mismatch/);
});
