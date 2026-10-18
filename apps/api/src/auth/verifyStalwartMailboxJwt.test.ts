import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPair, SignJWT } from "jose";
import { verifyStalwartMailboxJwt } from "./verifyStalwartMailboxJwt.js";

const principal = { productUserId: "product-a", authUserId: "auth-a", accountId: "mailbox-a" };
const settings = { issuer: "https://auth.example.test/api/auth", audience: "stalwart" };

test("valid signed mailbox token is bound to expected resource and user", async () => {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const token = await new SignJWT({ scope: "openid email" })
    .setProtectedHeader({ alg: "ES256" })
    .setIssuer(settings.issuer).setAudience(settings.audience)
    .setSubject(principal.authUserId).setIssuedAt().setExpirationTime("5m")
    .sign(privateKey);
  await assert.doesNotReject(verifyStalwartMailboxJwt(token, principal, publicKey, settings));
  await assert.rejects(verifyStalwartMailboxJwt(token, { ...principal, authUserId: "other" }, publicKey, settings));
  await assert.rejects(verifyStalwartMailboxJwt(token, principal, publicKey, { ...settings, audience: "mcp" }));
  await assert.rejects(verifyStalwartMailboxJwt(token, principal, publicKey, { ...settings, issuer: "https://other.example.test" }));
  const otherKeys = await generateKeyPair("ES256");
  await assert.rejects(verifyStalwartMailboxJwt(token, principal, otherKeys.publicKey, settings));
});

test("missing scope, expired token and opaque token are rejected", async () => {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const make = (scope: string, expires: number) => new SignJWT({ scope })
    .setProtectedHeader({ alg: "ES256" })
    .setIssuer(settings.issuer).setAudience(settings.audience)
    .setSubject(principal.authUserId)
    .setIssuedAt().setExpirationTime(expires)
    .sign(privateKey);
  await assert.rejects(verifyStalwartMailboxJwt(await make("openid", Math.floor(Date.now()/1000)+300), principal, publicKey, settings));
  await assert.rejects(verifyStalwartMailboxJwt(await make("openid email", Math.floor(Date.now()/1000)-100), principal, publicKey, settings));
  await assert.rejects(verifyStalwartMailboxJwt("opaque-token", principal, publicKey, settings));
});
