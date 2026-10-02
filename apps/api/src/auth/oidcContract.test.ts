import { strict as assert } from "node:assert";
import { test } from "node:test";
import { config } from "../config.js";
import {
  GSW_OIDC_SUPPORTED_SCOPES,
  gswOidcSubject,
  isLegacyInternalOidcClient,
  legacyInternalUserInfoClaims,
  oidcClientIdFromJwt,
} from "./oidcContract.js";

test("GSW OIDC supports the standard identity scopes while preserving offline access for Mobile", () => {
  assert.deepEqual([...GSW_OIDC_SUPPORTED_SCOPES], ["openid", "profile", "email", "offline_access"]);
});

test("OIDC subject is the immutable Better Auth user id, never email", () => {
  const user = { id: "auth-user-123", email: "old@example.com" };
  assert.equal(gswOidcSubject(user), "auth-user-123");
  user.email = "new@example.com";
  assert.equal(gswOidcSubject(user), "auth-user-123");
  assert.notEqual(gswOidcSubject(user), user.email);
});

test("OAuth client id is resolved from azp first, then client_id", () => {
  assert.equal(oidcClientIdFromJwt({ azp: "mobile", client_id: "other" }), "mobile");
  assert.equal(oidcClientIdFromJwt({ client_id: "legacy" }), "legacy");
  assert.equal(oidcClientIdFromJwt({}), undefined);
  assert.equal(oidcClientIdFromJwt(null), undefined);
});

test("only existing first-party clients receive legacy UserInfo convenience claims", () => {
  assert.equal(isLegacyInternalOidcClient(config.auth.mobileClientId), true);
  if (config.auth.oauthClientId) assert.equal(isLegacyInternalOidcClient(config.auth.oauthClientId), true);
  assert.equal(isLegacyInternalOidcClient("tc-remote"), false);
});

test("external clients do not receive name or preferred_username without profile through custom claims", () => {
  assert.deepEqual(legacyInternalUserInfoClaims({
    clientId: "tc-remote",
    scopes: ["openid", "email"],
    user: { email: "user@example.com", name: "User Name" },
  }), {});
});

test("legacy internal email-only UserInfo behavior is preserved", () => {
  assert.deepEqual(legacyInternalUserInfoClaims({
    clientId: config.auth.mobileClientId,
    scopes: ["openid", "email"],
    user: { email: "user@example.com", name: "User Name" },
  }), {
    email: "user@example.com",
    name: "User Name",
    preferred_username: "user@example.com",
  });
});

test("legacy internal convenience claims still require the email scope", () => {
  assert.deepEqual(legacyInternalUserInfoClaims({
    clientId: config.auth.mobileClientId,
    scopes: ["openid"],
    user: { email: "user@example.com", name: "User Name" },
  }), {});
});
