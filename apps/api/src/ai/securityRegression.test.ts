import test from "node:test";
import assert from "node:assert/strict";
import { AgentToolRegistry, agentMailRegistry } from "./tools/registry.js";

test("unknown tool names fail closed without executing any action", async () => {
  let called = false;
  const registry = new AgentToolRegistry([{
    name: "safe.read",
    description: "Safe",
    inputSchema: { type: "object" },
    requiredScopes: [],
    risk: "read",
    async execute(ctx, input, toolCallId) {
      called = true;
      return { ok: true, toolCallId, audit: { userId: ctx.userId, accountId: ctx.accountId, startedAt: "", completedAt: "" } };
    },
  }]);
  const result = await registry.execute("internal__read_secrets", "{}", {
    userId: "attacker", authUserId: "attacker", accountId: "mailbox-other-user", headers: {},
  }, "attack");
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "unknown_tool");
  assert.equal(called, false);
});

test("malformed arguments are rejected before a tool can execute", async () => {
  let called = false;
  const registry = new AgentToolRegistry([{
    name: "mock.write", description: "Write", inputSchema: { type: "object" },
    requiredScopes: ["mail.write"], risk: "reversible_write",
    async execute(ctx, input, toolCallId) {
      called = true;
      return { ok: true, toolCallId, audit: { userId: ctx.userId, accountId: ctx.accountId, startedAt: "", completedAt: "" } };
    },
  }]);
  const result = await registry.execute("mock__write", "{invalid", {
    userId: "attacker", authUserId: "attacker", accountId: "any", headers: {},
  }, "bad-args");
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "invalid_arguments");
  assert.equal(called, false);
});

test("the ordinary model tool registry exposes no secret, environment, SQL or shell tools", () => {
  const tools = agentMailRegistry.definitions();
  assert.ok(tools.length > 0);
  const forbidden = /(?:^|\.)(?:env|secrets?|sql|shell|exec|process|debug|logs?|database|repository)(?:\.|$)/i;
  for (const tool of tools) {
    assert.doesNotMatch(tool.name, forbidden, "unexpected privileged model tool: " + tool.name);
  }
  const unique = new Set(tools.map((tool) => tool.name));
  assert.equal(unique.size, tools.length, "duplicate tool names can shadow security policies");
});

test("external and mutating tools declare explicit scope and risk", () => {
  const tools = agentMailRegistry.definitions();
  for (const tool of tools) {
    assert.ok(["read", "reversible_write", "external"].includes(tool.risk), tool.name);
    if (tool.risk !== "read") assert.ok(tool.requiredScopes.length > 0, tool.name + " lacks scopes");
  }
  const sending = tools.find((tool) => tool.name === "mail.send_draft");
  assert.ok(sending);
  assert.equal(sending.risk, "external");
  assert.ok(sending.requiredScopes.includes("mail.send"));
});
