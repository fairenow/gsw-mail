import { strict as assert } from "node:assert";
import { test } from "node:test";
import { config } from "../config.js";
import {
  isTrustedProductBearerClient,
  isTrustedProductJwtBearer,
  normalizeOAuthScopes,
  resolveOrProvisionUser,
  selectRequestAuthSource,
} from "./middleware.js";

test("existing authenticated users do not run provisioning", async () => {
  let provisions = 0;
  const result = await resolveOrProvisionUser("stalwart", "alyssa@example.com", {
    resolve: async () => ({ id: "user-1", email: "alyssa@example.com" }),
    provision: async () => {
      provisions += 1;
      return { id: "user-1", email: "alyssa@example.com" };
    },
  });
  assert.deepEqual(result, { user: { id: "user-1", email: "alyssa@example.com" }, provisioned: false });
  assert.equal(provisions, 0);
});

test("unknown authenticated users are provisioned once", async () => {
  let provisions = 0;
  const result = await resolveOrProvisionUser("stalwart", "new@example.com", {
    resolve: async () => null,
    provision: async () => {
      provisions += 1;
      return { id: "user-2", email: "new@example.com" };
    },
  });
  assert.deepEqual(result, { user: { id: "user-2", email: "new@example.com" }, provisioned: true });
  assert.equal(provisions, 1);
});

test("browser session remains authoritative over bearer authentication", () => {
  assert.equal(selectRequestAuthSource(true, false), "session");
  assert.equal(selectRequestAuthSource(true, true), "session");
  assert.equal(selectRequestAuthSource(false, true), "bearer");
  assert.equal(selectRequestAuthSource(false, false), "none");
});

test("GSW Mobile is the only explicitly trusted opaque product bearer client", () => {
  assert.equal(isTrustedProductBearerClient(config.auth.mobileClientId), true);
  assert.equal(isTrustedProductBearerClient("tc-remote"), false);
  assert.equal(isTrustedProductBearerClient(config.auth.oauthClientId), false);
  assert.equal(isTrustedProductBearerClient(undefined), false);
});

test("GSW Mobile resource JWT is accepted for the existing product bearer path", () => {
  assert.equal(isTrustedProductJwtBearer(config.auth.mobileClientId, config.auth.stalwartAudience), true);
  assert.equal(isTrustedProductJwtBearer(config.auth.mobileClientId, [config.auth.stalwartAudience]), true);
});

test("TC Remote-style external JWT is rejected even with the current product scopes and resource audience", () => {
  const scopes = normalizeOAuthScopes("openid email");
  assert.deepEqual(scopes, ["openid", "email"]);
  assert.equal(isTrustedProductJwtBearer("tc-remote", config.auth.stalwartAudience), false);
});

test("token with correct scopes but wrong client is rejected", () => {
  const scopes = normalizeOAuthScopes(["openid", "email"]);
  assert.equal(scopes.includes("openid") && scopes.includes("email"), true);
  assert.equal(isTrustedProductBearerClient("external-client"), false);
  assert.equal(isTrustedProductJwtBearer("external-client", config.auth.stalwartAudience), false);
});

test("token with trusted mobile client but wrong resource audience is rejected", () => {
  assert.equal(isTrustedProductJwtBearer(config.auth.mobileClientId, "tc-remote-api"), false);
  assert.equal(isTrustedProductJwtBearer(config.auth.mobileClientId, ["other-resource"]), false);
  assert.equal(isTrustedProductJwtBearer(config.auth.mobileClientId, undefined), false);
});

test("Stalwart confidential client remains a resource client, not a GSW product bearer client", () => {
  if (!config.auth.oauthClientId) return;
  assert.notEqual(config.auth.oauthClientId, config.auth.mobileClientId);
  assert.equal(isTrustedProductJwtBearer(config.auth.oauthClientId, config.auth.stalwartAudience), false);
  assert.equal(isTrustedProductBearerClient(config.auth.oauthClientId), false);
});
