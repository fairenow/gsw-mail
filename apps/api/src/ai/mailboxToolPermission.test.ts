import assert from "node:assert/strict";
import test from "node:test";
import { requiredMailboxPermission } from "./mailboxToolPermission.js";

test("mailbox permission mapping is stable across native AI and MCP", () => {
  assert.equal(requiredMailboxPermission(["mail.read"]), "read");
  assert.equal(requiredMailboxPermission(["mail.write"]), "send");
  assert.equal(requiredMailboxPermission(["mail.send"]), "send");
  assert.equal(requiredMailboxPermission(["mail.read", "mail.send"]), "send");
  assert.equal(requiredMailboxPermission(["files.read"]), "read");
  assert.equal(requiredMailboxPermission([]), "read");
});
