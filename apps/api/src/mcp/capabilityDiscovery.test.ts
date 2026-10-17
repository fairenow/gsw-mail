import assert from "node:assert/strict";
import test from "node:test";
import { discoverMcpCapabilities } from "./capabilityDiscovery.js";
import type { AgentToolDefinition } from "../ai/tools/types.js";

const mock = (name: string, scopes: string[], risk: AgentToolDefinition["risk"]): AgentToolDefinition => ({
  name, description: name, requiredScopes: scopes, risk,
  inputSchema: { type: "object", properties: {} },
  async execute() { throw new Error("not called"); },
});

const tools = [
  mock("mail.search", ["mail.read"], "read"),
  mock("mail.create_draft", ["mail.draft"], "reversible_write"),
  mock("mail.send_draft", ["mail.send"], "external"),
];

test("distinguishes callable reads from disabled writes and missing scopes", () => {
  const result = discoverMcpCapabilities(tools, new Set(["mail.read", "mail.draft"]));
  assert.deepEqual(result.capabilities.map(c => [c.name, c.status]), [
    ["mail__create_draft", "write_transport_disabled"],
    ["mail__search", "available_for_read"],
    ["mail__send_draft", "oauth_scope_missing"],
  ]);
  assert.deepEqual(result.capabilities[2]?.missingScopes, ["mail.send"]);
});

test("supports search and pagination without exposing tool execution", () => {
  const first = discoverMcpCapabilities(tools, new Set(), { limit: 2 });
  assert.equal(first.total, 3);
  assert.equal(first.nextOffset, 2);
  const second = discoverMcpCapabilities(tools, new Set(), { limit: 2, offset: 2 });
  assert.equal(second.capabilities.length, 1);
  assert.equal(second.nextOffset, null);
  assert.equal(discoverMcpCapabilities(tools, new Set(), { query: "draft" }).total, 2);
});

test("rejects unbounded requests", () => {
  assert.throws(() => discoverMcpCapabilities(tools, new Set(), { limit: 101 }), /limit/);
  assert.throws(() => discoverMcpCapabilities(tools, new Set(), { offset: -1 }), /offset/);
});
