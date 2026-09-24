import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOAuthScopes } from "./middleware.js";

test("normalizes OAuth JWT scope claims", () => {
  assert.deepEqual(normalizeOAuthScopes("openid email offline_access"), ["openid", "email", "offline_access"]);
  assert.deepEqual(normalizeOAuthScopes(["openid", "email"]), ["openid", "email"]);
  assert.deepEqual(normalizeOAuthScopes(undefined), []);
});
