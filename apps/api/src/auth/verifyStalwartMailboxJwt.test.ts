import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPair, SignJWT } from "jose";
import { verifyStalwartMailboxJwt } from "./verifyStalwartMailboxJwt.js";

const principal = { productUserId: "product-a", authUserId: "auth-a", accountId: "mailbox-a" };
const settings = { issuer: "https://auth.example.test/api/auth", audience: "stalwart", mailboxAddress: "mailbox@example.test" };

test("valid signed mailbox token is bound to expected resource and user", async () => {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const token = await new SignJWT({ scope: "openid email", email: settings.mailboxAddress })
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
  const make = (scope: string, expires: number) => new SignJWT({ scope, email: settings.mailboxAddress })
    .setProtectedHeader({ alg: "ES256" })
    .setIssuer(settings.issuer).setAudience(settings.audience)
    .setSubject(principal.authUserId)
    .setIssuedAt().setExpirationTime(expires)
    .sign(privateKey);
  await assert.rejects(verifyStalwartMailboxJwt(await make("openid", Math.floor(Date.now()/1000)+300), principal, publicKey, settings));
  await assert.rejects(verifyStalwartMailboxJwt(await make("openid email", Math.floor(Date.now()/1000)-100), principal, publicKey, settings));
  await assert.rejects(verifyStalwartMailboxJwt("opaque-token", principal, publicKey, settings));
});

test("credential must have mailbox address and explicit expiry", async () => {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const signed = (claims: Record<string, unknown>, exp = true) => {
    let jwt = new SignJWT(claims).setProtectedHeader({ alg: "ES256" })
      .setIssuer(settings.issuer).setAudience(settings.audience)
      .setSubject(principal.authUserId).setIssuedAt();
    if (exp) jwt = jwt.setExpirationTime("5m");
    return jwt.sign(privateKey);
  };
  const token = await signed({ scope: "openid email", email: "mailbox@example.test" });
  await assert.rejects(verifyStalwartMailboxJwt(token, principal, publicKey, { ...settings, mailboxAddress: "other@example.test" }));
  await assert.rejects(verifyStalwartMailboxJwt(await signed({ scope: "openid email" }), principal, publicKey, settings));
  await assert.rejects(verifyStalwartMailboxJwt(await signed({ scope: "openid email", email: settings.mailboxAddress }, false), principal, publicKey, settings));
});
