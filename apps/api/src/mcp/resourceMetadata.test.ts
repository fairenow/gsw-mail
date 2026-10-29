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

test("MCP advertises the complete admin and mailbox scope inventory",()=>{
  assert.deepEqual(new Set(mcpAdvertisedScopes),new Set(aiScopes));
  for(const scope of ["workspace.read","workspace.admin","domain.read","domain.write","alias.read","alias.write","mailbox_admin.read","mailbox_admin.write","admin.health.read","admin.audit.read"]) assert.ok(mcpAdvertisedScopes.includes(scope as typeof aiScopes[number]),scope);
});
