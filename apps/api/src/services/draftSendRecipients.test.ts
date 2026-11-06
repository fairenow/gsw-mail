import assert from "node:assert/strict";
import test from "node:test";
import { draftSendRecipients } from "./draftSendRecipients.js";

test("draft sending preserves To, CC and BCC recipients for the outbound queue", () => {
  const recipients = draftSendRecipients({
    to: [{ email: "customer@example.com" }],
    cc: [{ email: "manager@example.com" }],
    bcc: [{ email: "audit@example.com" }, { email: "owner@example.com" }],
  });
  assert.deepEqual(recipients, {
    to: ["customer@example.com"],
    cc: ["manager@example.com"],
    bcc: ["audit@example.com", "owner@example.com"],
  });
});

test("drafts without BCC keep an empty hidden-recipient list", () => {
  assert.deepEqual(draftSendRecipients({ to: [{ email: "customer@example.com" }], cc: [] }).bcc, []);
});
