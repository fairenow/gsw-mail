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
