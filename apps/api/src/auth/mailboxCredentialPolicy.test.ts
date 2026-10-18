import assert from "node:assert/strict";
import test from "node:test";
import { canAttemptInteractiveMailboxAuthorization } from "./mailboxCredentialPolicy.js";

test("cold mailbox OAuth requires first-party session context", () => {
  assert.equal(canAttemptInteractiveMailboxAuthorization({}), false);
  assert.equal(canAttemptInteractiveMailboxAuthorization({ cookie: " " }), false);
  assert.equal(canAttemptInteractiveMailboxAuthorization({ cookie: "session=abc" }), true);
});

test("external bearer alone never authorizes session-based credential exchange", () => {
  assert.equal(canAttemptInteractiveMailboxAuthorization({ authorization: "Bearer external-mcp-oauth" }), false);
  assert.equal(canAttemptInteractiveMailboxAuthorization({ Authorization: "Bearer external-mcp-oauth" }), false);
});
