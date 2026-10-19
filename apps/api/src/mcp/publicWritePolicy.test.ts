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
test("rollout denial reasons keep the owner-only contract and name the missing approval", () => {
  const draft = { toolName: "mail.create_draft", risk: "reversible_write" as const, approvalId: id };
  for (const enabled of [undefined, "", "1", "TRUE", "false", "true "]) {
    const decision = publicMcpWriteDecision({ ...draft, enabled });
    assert.equal(decision.allowed, false);
    assert.equal("reason" in decision && decision.reason, "write_test_disabled");
  }
  const wrongTool = publicMcpWriteDecision({ enabled: "true", toolName: "mail__send_draft", risk: "reversible_write", approvalId: id });
  assert.equal("reason" in wrongTool && wrongTool.reason, "public_write_tool_not_approved");
  const noApproval = publicMcpWriteDecision({ enabled: "true", toolName: "mail__create_draft", risk: "reversible_write" });
  assert.equal("reason" in noApproval && noApproval.reason, "persisted_approval_required");
  assert.equal(publicMcpWriteDecision({ enabled: "true", toolName: "mail__create_draft", risk: "reversible_write", approvalId: id }).allowed, true);
});
