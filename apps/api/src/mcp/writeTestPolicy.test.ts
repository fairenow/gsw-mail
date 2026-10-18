import assert from "node:assert/strict";
import test from "node:test";
import { canUseMcpWriteTestMode, mcpWriteCallPolicy } from "./writeTestPolicy.js";

test("write test mode requires the configured owner and explicit enablement", () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  assert.equal(canUseMcpWriteTestMode({ userId, enabled: "true", allowedUserId: userId }), true);
  assert.equal(canUseMcpWriteTestMode({ userId, enabled: "false", allowedUserId: userId }), false);
  assert.equal(canUseMcpWriteTestMode({ userId, enabled: "true", allowedUserId: "" }), false);
});

test("external actions need an explicit acknowledgement", () => {
  const decision = mcpWriteCallPolicy({
    risk: "external", requestId: "22222222-2222-4222-8222-222222222222",
    confirmExternal: false, userId: "user-123456789", clientId: "client",
    accountId: "account", toolName: "example.action", argumentsValue: {},
  });
  assert.deepEqual(decision, { allowed: false, reason: "explicit_external_confirmation_required" });
});

test("same MCP request ID keeps a stable reservation across retries", () => {
  const base = {
    risk: "external" as const,
    requestId: "33333333-3333-4333-8333-333333333333",
    confirmExternal: true,
    userId: "user-123456789",
    clientId: "client-a",
    accountId: "account-a",
    toolName: "mail.send_draft",
    argumentsValue: { draftId: "draft-a" },
  };
  const first = mcpWriteCallPolicy(base);
  const replay = mcpWriteCallPolicy({ ...base, toolName: "mail__send_draft" });
  assert.equal(first.allowed, true);
  assert.equal(replay.allowed, true);
  if (!first.allowed || !replay.allowed) return;
  assert.equal(replay.key, first.key);
  assert.equal(replay.digest, first.digest);
});

test("MCP reservations isolate clients and callers and bind arguments", () => {
  const base = {
    risk: "external" as const,
    requestId: "44444444-4444-4444-8444-444444444444",
    confirmExternal: true,
    userId: "user-123456789",
    clientId: "client-a",
    accountId: "account-a",
    toolName: "mail.send_draft",
    argumentsValue: { draftId: "draft-a" },
  };
  const original = mcpWriteCallPolicy(base);
  const clientChange = mcpWriteCallPolicy({ ...base, clientId: "client-b" });
  const userChange = mcpWriteCallPolicy({ ...base, userId: "user-other-123" });
  const argumentsChange = mcpWriteCallPolicy({ ...base, argumentsValue: { draftId: "draft-b" } });
  const accountChange = mcpWriteCallPolicy({ ...base, accountId: "account-b" });
  assert.ok([original, clientChange, userChange, argumentsChange, accountChange].every(result => result.allowed));
  if (!original.allowed || !clientChange.allowed || !userChange.allowed || !argumentsChange.allowed || !accountChange.allowed) return;
  assert.notEqual(original.key, clientChange.key);
  assert.notEqual(original.key, userChange.key);
  assert.equal(original.key, argumentsChange.key, "request ID reuse is detected by the stored fingerprint");
  assert.notEqual(original.digest, argumentsChange.digest);
  assert.equal(original.key, accountChange.key);
  assert.notEqual(original.digest, accountChange.digest);
});

test("malformed action identifiers cannot reserve writes", () => {
  const decision = mcpWriteCallPolicy({
    risk: "reversible_write",
    requestId: "not-a-uuid",
    confirmExternal: false,
    userId: "user-123456789",
    clientId: "client-a",
    accountId: "account-a",
    toolName: "mail.create_draft",
    argumentsValue: {},
  });
  assert.deepEqual(decision, { allowed: false, reason: "request_id_uuid_required" });
});

test("shared confirmation classification protects always-confirm capabilities", () => {
  const base = {
    risk: "reversible_write" as const,
    requiredScopes: ["browser.write"],
    requestId: "55555555-5555-4555-8555-555555555555",
    confirmExternal: false,
    userId: "user-123456789",
    clientId: "client-a",
    accountId: "account-a",
    toolName: "browser.write",
    argumentsValue: {},
  };
  assert.deepEqual(mcpWriteCallPolicy(base), {
    allowed: false, reason: "explicit_external_confirmation_required",
  });
  assert.equal(mcpWriteCallPolicy({ ...base, confirmExternal: true }).allowed, true);
  assert.equal(mcpWriteCallPolicy({ ...base, requiredScopes: ["mail.write"] }).allowed, true);
});
