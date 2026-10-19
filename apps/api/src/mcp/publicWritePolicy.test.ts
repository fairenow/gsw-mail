import assert from "node:assert/strict";
import test from "node:test";
import { publicMcpWriteDecision } from "./publicWritePolicy.js";
const id = "00000000-0000-4000-8000-000000000001";
test("public writes default off and require a real persisted approval id", () => {
  const base = { toolName: "mail.create_draft", risk: "reversible_write" as const };
  assert.equal(publicMcpWriteDecision({ ...base, approvalId: id }).allowed, false);
  assert.equal(publicMcpWriteDecision({ ...base, enabled: "true" }).allowed, false);
  assert.equal(publicMcpWriteDecision({ ...base, enabled: "true", approvalId: "invalid" }).allowed, false);
  assert.equal(publicMcpWriteDecision({ ...base, enabled: "true", approvalId: id }).allowed, true);
});
test("public rollout never enables send, destructive, or arbitrary tool writes", () => {
  for (const toolName of ["mail.send_draft", "mail.trash_draft", "contacts.create", "calendar.events.create"]) {
    assert.equal(publicMcpWriteDecision({ enabled: "true", toolName, risk: "reversible_write", approvalId: id }).allowed, false);
  }
  assert.equal(publicMcpWriteDecision({ enabled: "true", toolName: "mail.create_draft", risk: "external", approvalId: id }).allowed, false);
});
