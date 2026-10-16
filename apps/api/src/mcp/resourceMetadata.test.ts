import assert from "node:assert/strict";
import test from "node:test";
import { aiScopes } from "../ai/permissions/types.js";
import { mcpAdvertisedScopes } from "./resourceMetadata.js";

test("MCP advertised resource scopes all exist in OAuth authorization server",()=>{
  const allowed=new Set<string>(aiScopes);
  assert.ok(mcpAdvertisedScopes.length>0);
  assert.deepEqual(mcpAdvertisedScopes.filter(scope=>!allowed.has(scope)),[]);
  assert.ok(mcpAdvertisedScopes.includes("automations.read"));
  assert.ok(mcpAdvertisedScopes.includes("automations.write"));
});
