import assert from "node:assert/strict";
import test from "node:test";
import { describeMcpDraft, mcpPrepareDraftRequest } from "./prepareDraftAction.js";

const valid = {
  accountId: "a0000000-0000-4000-8000-000000000001",
  toolName: "mail.create_draft",
  arguments: { to: ["person@example.com"], subject: "Hello", textBody: "Draft body" },
};
test("accepts a bounded draft proposal and generates a safe summary", () => {
  const parsed = mcpPrepareDraftRequest.parse(valid);
  assert.equal(parsed.toolName, "mail.create_draft");
  assert.equal(describeMcpDraft(parsed.arguments), "Create email draft for 1 recipient(s), subject: Hello");
});
test("does not permit sending, unknown actions, or unrecognized fields", () => {
  for (const request of [
    { ...valid, toolName: "mail.send_draft" },
    { ...valid, arguments: { ...valid.arguments, send: true } },
    { ...valid, accountId: "invalid" },
    { ...valid, arguments: { to: ["not-an-email"] } },
  ]) assert.equal(mcpPrepareDraftRequest.safeParse(request).success, false);
});
test("normalizes control characters and bounds the approval summary", () => {
  const summary = describeMcpDraft({ to: ["a@example.com"], subject: "Hello\r\nWorld".repeat(200) });
  assert.ok(summary.length <= 1000);
  assert.ok(!summary.includes("\n"));
});
