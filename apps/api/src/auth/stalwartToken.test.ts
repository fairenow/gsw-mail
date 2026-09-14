import { strict as assert } from "node:assert";
import { test } from "node:test";
import { decodeStalwartTokenMetadata } from "./stalwartToken.js";

const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

test("decodes only safe Better Auth token metadata", () => {
  const token = `${encoded({ alg: "ES256", kid: "key-1" })}.${encoded({
    iss: "https://mail.guidedstepswellness.com/api/auth",
    aud: "stalwart",
    email: "ramon@team.guidedstepswellness.com",
    preferred_username: "ramon@team.guidedstepswellness.com",
    scope: "openid email",
    exp: 1_800_000_000,
    secret: "must-not-be-returned",
  })}.signature`;

  assert.deepEqual(decodeStalwartTokenMetadata(token), {
    alg: "ES256",
    kid: "key-1",
    iss: "https://mail.guidedstepswellness.com/api/auth",
    aud: "stalwart",
    email: "ramon@team.guidedstepswellness.com",
    preferred_username: "ramon@team.guidedstepswellness.com",
    scope: "openid email",
    exp: 1_800_000_000,
  });
});

test("does not fail token exchange diagnostics for opaque or malformed tokens", () => {
  assert.equal(decodeStalwartTokenMetadata("not-a-jwt"), undefined);
});
