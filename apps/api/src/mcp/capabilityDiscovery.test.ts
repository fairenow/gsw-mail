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

const publicTools = [
  mock("mail.search", ["mail.read"], "read"),
  mock("mail.create_draft", ["mail.write"], "reversible_write"),
  mock("mail.update_draft", ["mail.write"], "reversible_write"),
  mock("mail.trash_draft", ["mail.write"], "external"),
  mock("mail.send_draft", ["mail.send"], "external"),
];
const publicScopes = new Set(["mail.read", "mail.write", "mail.send"]);

test("advertises approved public draft creation only while the rollout flag is set", () => {
  const off = discoverMcpCapabilities(publicTools, publicScopes);
  assert.deepEqual(off.capabilities.map(entry => [entry.name, entry.status]), [
    ["mail__create_draft", "write_transport_disabled"],
    ["mail__search", "available_for_read"],
    ["mail__send_draft", "write_transport_disabled"],
    ["mail__trash_draft", "write_transport_disabled"],
    ["mail__update_draft", "write_transport_disabled"],
  ]);
  const on = discoverMcpCapabilities(publicTools, publicScopes, { publicWriteEnabled: true });
  assert.deepEqual(on.capabilities.map(entry => [entry.name, entry.status]), [
    ["mail__create_draft", "available_for_approved_write"],
    ["mail__search", "available_for_read"],
    ["mail__send_draft", "write_transport_disabled"],
    ["mail__trash_draft", "write_transport_disabled"],
    ["mail__update_draft", "write_transport_disabled"],
  ]);
  assert.match(String(on.note), /approval/i);
  assert.doesNotMatch(String(off.note), /approval/i);
});

test("owner write-test mode and missing scopes still win over public discovery", () => {
  const both = discoverMcpCapabilities(publicTools, publicScopes, { publicWriteEnabled: true, writeTestEnabled: true });
  assert.equal(both.capabilities.find(entry => entry.name === "mail__create_draft")?.status, "available_for_test_write");
  assert.match(String(both.note), /Owner-only write test mode/);
  const noScopes = discoverMcpCapabilities(publicTools, new Set(["mail.read"]), { publicWriteEnabled: true });
  assert.deepEqual(noScopes.capabilities.find(entry => entry.name === "mail__create_draft"), {
    name: "mail__create_draft",
    description: "mail.create_draft",
    requiredScopes: ["mail.write"],
    risk: "reversible_write",
    status: "oauth_scope_missing",
    missingScopes: ["mail.write"],
  });
});
