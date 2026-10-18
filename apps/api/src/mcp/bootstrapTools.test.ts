import assert from "node:assert/strict";
import test from "node:test";
import { mcpBootstrapTools } from "./bootstrapTools.js";

test("bootstrap tools expose discovery and narrowly scoped draft preparation", () => {
  assert.deepEqual(mcpBootstrapTools.map(tool => tool.name), [
    "get_current_user", "list_capabilities", "prepare_action", "grant_my_scopes", "list_accounts",
  ]);
  const toolsByName = new Map(mcpBootstrapTools.map(tool => [tool.name, tool]));
  assert.deepEqual(toolsByName.get("get_current_user")?.requiredScopes, ["openid"]);
  assert.deepEqual(toolsByName.get("list_capabilities")?.requiredScopes, ["openid"]);
  assert.deepEqual(toolsByName.get("list_accounts")?.requiredScopes, ["mail.read"]);
  assert.deepEqual(toolsByName.get("prepare_action")?.requiredScopes, ["mail.write"]);
  assert.deepEqual(toolsByName.get("grant_my_scopes")?.requiredScopes, ["openid"]);

  for (const tool of mcpBootstrapTools) {
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
  for (const name of ["get_current_user", "list_capabilities", "list_accounts"] as const) {
    assert.ok(!("accountId" in toolsByName.get(name)!.inputSchema.properties));
  }
  const grant = toolsByName.get("grant_my_scopes")!;
  assert.ok("accountId" in grant.inputSchema.properties);
  assert.ok("scopes" in grant.inputSchema.properties);
  assert.ok("confirmGrant" in grant.inputSchema.properties);
  const prepare = toolsByName.get("prepare_action")!;
  assert.ok("accountId" in prepare.inputSchema.properties);
  assert.ok("toolName" in prepare.inputSchema.properties);
  assert.ok("arguments" in prepare.inputSchema.properties);
  assert.ok("required" in prepare.inputSchema);
  if ("required" in prepare.inputSchema) {
    assert.ok((prepare.inputSchema.required as readonly string[]).includes("accountId"));
    assert.ok((prepare.inputSchema.required as readonly string[]).includes("toolName"));
    assert.ok((prepare.inputSchema.required as readonly string[]).includes("arguments"));
  }
});
