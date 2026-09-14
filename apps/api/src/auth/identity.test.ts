import { strict as assert } from "node:assert";
import { test } from "node:test";
import { identityClaims, verifyAccessToken } from "./identity.js";

const valid = { active: true, username: "ramon@example.com", token_type: "bearer", exp: Date.now() / 1000 + 300 };

test("legacy introspection claims remain isolated from JWT verification", () => {
  assert.equal(identityClaims(valid)?.sub, valid.username);
});

test("malformed or unsigned access tokens fail closed", async () => {
  assert.equal(await verifyAccessToken("not-a-jwt"), null);
  for (const value of [null, {}, { ...valid, active: false }, { ...valid, username: "" }, { ...valid, exp: 1 }]) {
    assert.equal(identityClaims(value), null);
  }
});
