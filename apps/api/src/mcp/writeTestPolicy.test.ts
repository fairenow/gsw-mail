import assert from "node:assert/strict";
import test from "node:test";
import { canUseMcpWriteTestMode } from "./writeTestPolicy.js";

test("write test mode requires the configured owner and explicit enablement", () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  assert.equal(canUseMcpWriteTestMode({ userId, enabled: "true", allowedUserId: userId }), true);
  assert.equal(canUseMcpWriteTestMode({ userId, enabled: "false", allowedUserId: userId }), false);
  assert.equal(canUseMcpWriteTestMode({ userId, enabled: "true", allowedUserId: "" }), false);
});
