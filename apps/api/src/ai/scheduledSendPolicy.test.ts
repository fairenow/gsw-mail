import test from "node:test";
import assert from "node:assert/strict";
import { scheduledSendKey, scheduledSendRecipientsAllowed } from "./scheduledSendPolicy.js";

const policy = { enabled: true, approvedAt: "2026-10-09T00:00:00Z", approvedBy: "user", version: 1, allowedRecipients: ["a@example.com", "b@example.com"] };

test("all TO, CC and BCC recipients must match approved addresses", () => {
  assert.equal(scheduledSendRecipientsAllowed(policy, ["A@example.com", "b@example.com"]), true);
  assert.equal(scheduledSendRecipientsAllowed(policy, ["a@example.com", "outside@example.com"]), false);
  assert.equal(scheduledSendRecipientsAllowed(null, ["a@example.com"]), false);
  assert.equal(scheduledSendRecipientsAllowed(policy, []), false);
});

test("scheduled sends deduplicate by automation, mailbox and draft, not model call ID", () => {
  assert.equal(scheduledSendKey("task", "account", "draft"), scheduledSendKey("task", "account", "draft"));
  assert.notEqual(scheduledSendKey("task", "account", "draft"), scheduledSendKey("task", "account", "another"));
});
