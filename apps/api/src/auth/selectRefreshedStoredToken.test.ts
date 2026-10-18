import assert from "node:assert/strict";
import test from "node:test";
import { selectRefreshedStoredToken } from "./selectRefreshedStoredToken.js";

test("refreshed-token selection never returns an unverified or unrenewable credential", async () => {
  const candidates = [
    { clientId: "no-email", token: "t-missing-scope", scopes: ["openid"] },
    { clientId: "blank", token: "", scopes: ["email"] },
    { clientId: "revoked", token: "t-revoked", scopes: ["email"] },
    { clientId: "unverifiable", token: "t-unverifiable", scopes: ["email"] },
    { clientId: "renewable", token: "t-renewable", scopes: ["email"] },
  ];

  const result = await selectRefreshedStoredToken(
    candidates,
    async (candidate) => {
      if (candidate.clientId === "revoked") throw new Error("invalid_grant");
      return `access-${candidate.clientId}`;
    },
    async (token) => {
      if (token === "access-unverifiable") throw new Error("mailbox_token_claims_mismatch");
    },
  );

  assert.equal(result, "access-renewable");
});

test("refreshed-token selection fails closed when every candidate is unusable", async () => {
  const result = await selectRefreshedStoredToken(
    [{ clientId: "revoked", token: "t-revoked", scopes: ["email"] }],
    async () => { throw new Error("invalid_grant"); },
    async () => undefined,
  );
  assert.equal(result, null);
});
