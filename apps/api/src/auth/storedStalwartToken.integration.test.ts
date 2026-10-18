import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPair, SignJWT } from "jose";
import { selectVerifiedStoredToken } from "./selectStoredStalwartToken.js";
import { verifyStalwartMailboxJwt } from "./verifyStalwartMailboxJwt.js";

const issuer = "https://auth.example.test/api/auth";
const audience = "stalwart";
const principal = { productUserId: "product-a", authUserId: "auth-a", accountId: "account-a" };

test("persisted-token selection accepts only a signed, scoped, account-bound credential", async () => {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const sign = (subject: string, email: string, tokenAudience = audience) =>
    new SignJWT({ email, scope: "openid email" })
      .setProtectedHeader({ alg: "ES256" })
      .setIssuer(issuer).setAudience(tokenAudience)
      .setSubject(subject).setIssuedAt().setExpirationTime("5m")
      .sign(privateKey);

  const wrongUser = await sign("auth-b", "mailbox@example.test");
  const wrongMailbox = await sign("auth-a", "another@example.test");
  const wrongAudience = await sign("auth-a", "mailbox@example.test", "mcp");
  const correct = await sign("auth-a", "mailbox@example.test");
  const candidates = [wrongUser, wrongMailbox, wrongAudience, correct]
    .map(token => ({ token, scopes: ["email"] }));

  const verify = (token: string) => verifyStalwartMailboxJwt(token, principal, publicKey, {
    issuer, audience, mailboxAddress: "mailbox@example.test",
  });
  assert.equal(await selectVerifiedStoredToken(candidates, verify), correct);
  assert.equal(await selectVerifiedStoredToken(candidates.slice(0, 3), verify), null);
});

test("invalid signature never becomes an eligible persisted mailbox credential", async () => {
  const trusted = await generateKeyPair("ES256");
  const attacker = await generateKeyPair("ES256");
  const token = await new SignJWT({ email: "mailbox@example.test", scope: "email" })
    .setProtectedHeader({ alg: "ES256" }).setIssuer(issuer).setAudience(audience)
    .setSubject("auth-a").setIssuedAt().setExpirationTime("5m")
    .sign(attacker.privateKey);

  const result = await selectVerifiedStoredToken([{ token, scopes: ["email"] }], t =>
    verifyStalwartMailboxJwt(t, principal, trusted.publicKey, { issuer, audience, mailboxAddress: "mailbox@example.test" }));
  assert.equal(result, null);
});
