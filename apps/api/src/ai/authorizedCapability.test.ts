import assert from "node:assert/strict";
import test from "node:test";
import { AgentToolRegistry } from "../ai/tools/registry.js";
import { executeAuthorizedCapability } from "./authorizedCapability.js";

test("registry handles dotted and MCP-formatted tool names identically", async () => {
  const calls: unknown[] = [];
  const registry = new AgentToolRegistry([{
    name: "sample.read", description: "Test", inputSchema: {},
    requiredScopes: [], risk: "read",
    execute: async (ctx, value, id) => {
      calls.push({ ctx, value, id });
      return { ok: true, toolCallId: id, data: value,
        audit: { userId: ctx.userId, accountId: ctx.accountId, startedAt: "", completedAt: "" } };
    },
  }]);
  const context = { userId: "u", authUserId: "a", accountId: "m", headers: {} };
  const left = await registry.execute("sample.read", JSON.stringify({ x: 1 }), context, "call-a");
  const right = await registry.execute("sample__read", JSON.stringify({ x: 1 }), context, "call-b");
  assert.equal(left.ok, true);
  assert.equal(right.ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual((left as { data?: unknown }).data, (right as { data?: unknown }).data);
});

test("shared executor preserves injected registry, call ID and raw JSON validation", async () => {
  const registry = new AgentToolRegistry([{
    name: "test.echo", description: "Echo", inputSchema: {},
    requiredScopes: [], risk: "read",
    execute: async (ctx, value, id) => ({
      ok: true, toolCallId: id, data: value,
      audit: { userId: ctx.userId, accountId: ctx.accountId, startedAt: "", completedAt: "" },
    }),
  }]);
  const context = { userId: "u", authUserId: "a", accountId: "m", headers: {} };
  const ok = await executeAuthorizedCapability({
    registry, toolName: "test__echo", rawArguments: '{"hello":true}',
    context, toolCallId: "native-call",
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.toolCallId, "native-call");
  assert.deepEqual(ok.data, { hello: true });
  const malformed = await executeAuthorizedCapability({
    registry, toolName: "test.echo", rawArguments: "{bad",
    context, toolCallId: "bad-call",
  });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.error?.code, "invalid_arguments");
});
