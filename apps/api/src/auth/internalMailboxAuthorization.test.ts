import assert from "node:assert/strict";
import test from "node:test";
import { requiresMailboxAccountSelection, withInternalMailboxIdentity } from "./internalMailboxAuthorization.js";

test("ordinary OAuth always retains account selection", () => {
  assert.equal(requiresMailboxAccountSelection("alice"), true);
});

test("internal authorization skips the chooser only for the selected identity", async () => {
  await withInternalMailboxIdentity("alice", async () => {
    await Promise.resolve();
    assert.equal(requiresMailboxAccountSelection("alice"), false);
    assert.equal(requiresMailboxAccountSelection("bob"), true);
    assert.equal(requiresMailboxAccountSelection(""), true);
  });
  assert.equal(requiresMailboxAccountSelection("alice"), true);
});

test("concurrent requests cannot inherit another mailbox authorization context", async () => {
  await Promise.all(["alice", "bob"].map(userId => withInternalMailboxIdentity(userId, async () => {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requiresMailboxAccountSelection(userId), false);
    assert.equal(requiresMailboxAccountSelection(userId === "alice" ? "bob" : "alice"), true);
  })));
});
