import assert from "node:assert/strict";
import test from "node:test";
import { selectVerifiedStoredToken } from "./selectStoredStalwartToken.js";

test("selects only a token that passes mailbox verification", async () => {
  const checked: string[] = [];
  const selected = await selectVerifiedStoredToken([
    { token: "wrong-scope", scopes: ["openid"] },
    { token: "wrong-identity", scopes: ["email"] },
    { token: "valid", scopes: ["email"] },
  ], async token => {
    checked.push(token);
    if (token !== "valid") throw new Error("invalid");
  });
  assert.equal(selected, "valid");
  assert.deepEqual(checked, ["wrong-identity", "valid"]);
});

test("returns null if no eligible, verified credential is available", async () => {
  assert.equal(await selectVerifiedStoredToken([], async () => {}), null);
  assert.equal(await selectVerifiedStoredToken([{ token: "bad", scopes: ["email"] }], async () => {
    throw new Error("invalid");
  }), null);
  assert.equal(await selectVerifiedStoredToken([{ token: "", scopes: ["email"] }], async () => {}), null);
});
