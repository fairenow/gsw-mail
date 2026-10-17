import assert from "node:assert/strict";
import test from "node:test";
import { mcpBootstrapTools } from "./bootstrapTools.js";

test("bootstrap tools discover account IDs without needing one", () => {
  assert.deepEqual(mcpBootstrapTools.map(t=>t.name),["get_current_user","list_accounts"]);
  assert.deepEqual(mcpBootstrapTools[0].requiredScopes,["openid"]);
  assert.deepEqual(mcpBootstrapTools[1].requiredScopes,["mail.read"]);
  for(const tool of mcpBootstrapTools) {
    assert.equal(tool.inputSchema.additionalProperties,false);
    assert.ok(!("accountId" in tool.inputSchema.properties));
  }
});
