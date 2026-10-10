import test from "node:test";
import assert from "node:assert/strict";
import { mayRunScheduledTool } from "./automationPolicy.js";
import type { AgentToolDefinition } from "./tools/types.js";

const tool = (risk: "read" | "reversible_write" | "external", scopes: string[]) =>
  ({ name: "test.action", risk, requiredScopes: scopes }) as AgentToolDefinition;

test("read tools require both schedule authorization and current grants", () => {
  const t = tool("read", ["browser.read"]);
  assert.equal(mayRunScheduledTool(t, ["browser.read"], ["browser.read"]), true);
  assert.equal(mayRunScheduledTool(t, ["browser.read"], []), false);
  assert.equal(mayRunScheduledTool(t, [], ["browser.read"]), false);
});
test("unattended mutations and external actions are denied", () => {
  assert.equal(mayRunScheduledTool(tool("reversible_write", ["files.write"]), ["files.write"], ["files.write"]), false);
  assert.equal(mayRunScheduledTool(tool("external", ["mail.send"]), ["mail.send"], ["mail.send"]), false);
});
test("mixed-scope tools require every scope", () => {
  assert.equal(mayRunScheduledTool(tool("read", ["mail.read", "contacts.read"]), ["mail.read"], ["mail.read", "contacts.read"]), false);
});
