import { strict as assert } from "node:assert";
import { test } from "node:test";
import { config } from "../config.js";
import { identityClaims, verifyAccessToken } from "./identity.js";

const valid = { active: true, username: "ramon@example.com", token_type: "bearer", exp: Date.now() / 1000 + 300 };

test("introspection authenticates as the backend client, inspecting the caller's token", async () => {
  const expected = `Basic ${Buffer.from(`${config.auth.introspectionClientId}:${config.auth.introspectionClientSecret ?? ""}`).toString("base64")}`;
  const claims = await verifyAccessToken("opaque-token", async (_url, init) => {
    assert.equal((init?.headers as Record<string, string>).authorization, expected);
    assert.equal(new URLSearchParams(String(init?.body)).get("token"), "opaque-token");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    return new Response(JSON.stringify(valid));
  });
  assert.equal(claims?.sub, valid.username);
});

test("inactive, expired, malformed and wrong-type introspections fail closed", () => {
  for (const value of [null, {}, { ...valid, active: false }, { ...valid, active: "true" }, { ...valid, username: "" }, { ...valid, username: 3 }, { ...valid, exp: 1 }, { ...valid, exp: "9999999999" }, { ...valid, token_type: "refresh_token" }]) assert.equal(identityClaims(value), null);
});

test("upstream refusal cannot authenticate a caller", async () => {
  assert.equal(await verifyAccessToken("bad", async () => new Response("", { status: 401 })), null);
});

test("network and JSON failures never produce claims", async () => {
  await assert.rejects(verifyAccessToken("bad", async () => { throw new Error("network"); }));
  await assert.rejects(verifyAccessToken("bad", async () => new Response("not json")));
});
