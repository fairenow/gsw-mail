import test from "node:test";
import assert from "node:assert/strict";
import { requiredMailboxPermission } from "./agentExecutor.js";

test("mail read scopes require read access", () => {
  assert.equal(requiredMailboxPermission(["mail.read"]), "read");
});
test("mail write and send scopes require mailbox send permission", () => {
  assert.equal(requiredMailboxPermission(["mail.write"]), "send");
  assert.equal(requiredMailboxPermission(["mail.send"]), "send");
  assert.equal(requiredMailboxPermission(["files.read", "mail.send"]), "send");
});
test("non-mail tools cannot elevate account access", () => {
  assert.equal(requiredMailboxPermission(["files.read"]), "read");
  assert.equal(requiredMailboxPermission([]), "read");
});
