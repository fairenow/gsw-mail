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
test("only allowlisted reversible writes can run unattended", () => {
  assert.equal(mayRunScheduledTool(tool("reversible_write", ["files.write"]), ["files.write"], ["files.write"]), false);
  assert.equal(mayRunScheduledTool({ ...tool("reversible_write", ["mail.write"]), name: "mail.create_draft" }, ["mail.write"], ["mail.write"]), true);
  assert.equal(mayRunScheduledTool({ ...tool("reversible_write", ["mail.write"]), name: "mail.update_draft" }, ["mail.write"], ["mail.write"]), false);
  assert.equal(mayRunScheduledTool(tool("external", ["mail.send"]), ["mail.send"], ["mail.send"]), false);
});
test("mixed-scope tools require every scope", () => {
  assert.equal(mayRunScheduledTool(tool("read", ["mail.read", "contacts.read"]), ["mail.read"], ["mail.read", "contacts.read"]), false);
});

test("scheduled sending requires explicit approval and live mail.send grant", () => {
  const send = { ...tool("external", ["mail.send"]), name: "mail.send_draft" };
  assert.equal(mayRunScheduledTool(send, ["mail.send"], ["mail.send"], false), false);
  assert.equal(mayRunScheduledTool(send, ["mail.send"], [], true), false);
  assert.equal(mayRunScheduledTool(send, ["mail.send"], ["mail.send"], true), true);
  assert.equal(mayRunScheduledTool({ ...send, name: "campaign.launch" }, ["mail.send"], ["mail.send"], true), false);
});
