import assert from "node:assert/strict";
import test from "node:test";
import { firstDisabledCapabilityScope, firstMissingCapabilityGrant } from "./capabilityScopePolicy.js";

test("capability evaluation follows the same requirement ordering across transports", () => {
  const required = ["mail.read", "mail.send"];
  assert.equal(firstDisabledCapabilityScope(required, s => s === "mail.read"), "mail.send");
  assert.equal(firstMissingCapabilityGrant(required, new Set(["mail.send"])), "mail.read");
  assert.equal(firstDisabledCapabilityScope(required, () => true), undefined);
  assert.equal(firstMissingCapabilityGrant(required, new Set(required)), undefined);
});
test("empty requirements are not blocked", () => {
  assert.equal(firstDisabledCapabilityScope([], () => false), undefined);
  assert.equal(firstMissingCapabilityGrant([], new Set()), undefined);
});
