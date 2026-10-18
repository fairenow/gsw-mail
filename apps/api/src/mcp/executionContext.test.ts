import assert from "node:assert/strict";
import test from "node:test";
import { createMcpExecutionContext } from "./executionContext.js";

const principal = { userId: "product-user", authUserId: "auth-user" };

test("MCP context binds the verified principal to its authorized account", () => {
  assert.deepEqual(createMcpExecutionContext(principal, "account-a"), {
    userId: "product-user", authUserId: "auth-user",
    accountId: "account-a", headers: {},
  });
});

test("MCP context cannot inherit the external bearer or untrusted headers", () => {
  const supplied = { ...principal, authorization: "Bearer external-mcp-token", headers: { cookie: "invalid" } };
  const ctx = createMcpExecutionContext(supplied, "account-a");
  assert.deepEqual(ctx.headers, {});
  assert.equal("accessToken" in ctx, false);
  assert.equal("authorization" in ctx, false);
});

test("only sending propagates an existing reservation to the mail service", () => {
  const action = { toolName: "mail.send_draft", reservedActionKey: "mcp:reserved-id" };
  assert.equal(createMcpExecutionContext(principal, "account-a", action).scheduledIdempotencyKey, "mcp:reserved-id");
  assert.equal(createMcpExecutionContext(principal, "account-a", { ...action, toolName: "mail.create_draft" }).scheduledIdempotencyKey, undefined);
});
