import assert from "node:assert/strict";
import test from "node:test";
import { AgentToolRegistry } from "../ai/tools/registry.js";

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
