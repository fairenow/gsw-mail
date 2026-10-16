import assert from "node:assert/strict";
import test from "node:test";
import { canonicalMcpOAuthScopes, legacyMcpOAuthScopes } from "./scopeAliases.js";
import { consentPermitsMcpToken } from "./consentPolicy.js";
import { mcpAdvertisedScopes } from "./resourceMetadata.js";

test("legacy OAuth names remain accepted but never advertised", () => {
  assert.deepEqual(legacyMcpOAuthScopes, ["automation.read", "automation.write"]);
  assert.ok(!mcpAdvertisedScopes.includes("automation.read" as never));
  assert.ok(!mcpAdvertisedScopes.includes("automation.write" as never));
});
test("only approved legacy scopes map to canonical tool permissions", () => {
  const issued = new Set(["openid", "automation.read"]);
  assert.equal(consentPermitsMcpToken({
    tokenScopes: issued, consentScopes: ["openid", "automation.read"], clientDisabled: false,
  }), true);
  assert.deepEqual([...canonicalMcpOAuthScopes(issued)].sort(), ["automations.read", "openid"]);
  assert.equal(consentPermitsMcpToken({
    tokenScopes: issued, consentScopes: ["openid"], clientDisabled: false,
  }), false);
  assert.equal(consentPermitsMcpToken({
    tokenScopes: issued, consentScopes: ["openid", "automation.read"], clientDisabled: true,
  }), false);
  assert.ok(!canonicalMcpOAuthScopes(["automation.read"]).has("automations.write"));
});
