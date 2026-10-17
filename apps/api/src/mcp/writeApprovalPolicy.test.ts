import assert from "node:assert/strict";
import test from "node:test";
import { mcpArgumentsDigest, verifyPersistedMcpApproval, type PersistedMcpApproval } from "./writeApprovalPolicy.js";

const args = { to: ["recipient@example.com"], subject: "Hello" };
const approval: PersistedMcpApproval = {
  id: "approval-1", userId: "user-1", accountId: "account-1", clientId: "client-1",
  toolName: "mail.create_draft", argumentsDigest: mcpArgumentsDigest(args),
  status: "approved", expiresAt: new Date("2026-12-01T00:00:00Z"),
};
const base = { risk: "reversible_write" as const, userId: "user-1", accountId: "account-1", clientId: "client-1",
  toolName: "mail__create_draft", argumentsValue: args, approval, now: new Date("2026-11-01T00:00:00Z") };

test("binds persisted approval to identity, client, account, action, and exact arguments", () => {
  assert.deepEqual(verifyPersistedMcpApproval(base), { allowed: true, approvalId: "approval-1" });
  for (const change of [
    { userId: "other" }, { accountId: "other" }, { clientId: "other" },
    { toolName: "mail__send_draft" }, { argumentsValue: { ...args, subject: "Different" } },
  ]) assert.equal(verifyPersistedMcpApproval({ ...base, ...change }).allowed, false);
});
test("rejects absent, expired, revoked, pending, and consumed approvals", () => {
  assert.equal(verifyPersistedMcpApproval({ ...base, approval: null }).allowed, false);
  assert.equal(verifyPersistedMcpApproval({ ...base, now: approval.expiresAt }).allowed, false);
  for (const status of ["revoked", "pending", "rejected", "consumed"] as const) {
    assert.equal(verifyPersistedMcpApproval({ ...base, approval: { ...approval, status } }).allowed, false);
  }
});
test("argument digest is stable across object key ordering but not values", () => {
  assert.equal(mcpArgumentsDigest({ b: 2, a: [1, 2] }), mcpArgumentsDigest({ a: [1, 2], b: 2 }));
  assert.notEqual(mcpArgumentsDigest({ a: 1 }), mcpArgumentsDigest({ a: 2 }));
  assert.equal(verifyPersistedMcpApproval({ ...base, approval: { ...approval, argumentsDigest: "invalid" } }).allowed, false);
});
