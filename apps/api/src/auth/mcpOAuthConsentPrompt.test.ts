import assert from "node:assert/strict";
import test from "node:test";
import { requireFreshExternalMcpConsent } from "./mcpOAuthConsentPrompt.js";

const issuer = "https://mail.guidedstepswellness.com";
const authorize = (query: string) => issuer + "/api/auth/oauth2/authorize?" + query;
const firstParty = new Set(["gsw-web"]);

test("adds consent for external MCP client with product scopes", () => {
  const url = requireFreshExternalMcpConsent(authorize("client_id=chatgpt&scope=openid%20templates.read%20templates.write&state=original"), firstParty);
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("prompt"), "consent");
  assert.equal(parsed.searchParams.get("state"), "original");
  assert.equal(parsed.searchParams.get("scope"), "openid templates.read templates.write");
});
test("requests fresh consent with previous login and account prompts", () => {
  const url = requireFreshExternalMcpConsent(authorize("client_id=chatgpt&scope=mail.read&prompt=login%20select_account"), firstParty);
  assert.equal(new URL(url).searchParams.get("prompt"), "login select_account consent");
});
test("honors unattended prompt=none, leaving OAuth provider to enforce interaction_required", () => {
  const initial = authorize("client_id=chatgpt&scope=mail.read&prompt=none");
  assert.equal(requireFreshExternalMcpConsent(initial, firstParty), initial);
});
test("does not change native GSW clients or ordinary OAuth identity authorizations", () => {
  const native = authorize("client_id=gsw-web&scope=mail.read");
  const identity = authorize("client_id=external&scope=openid%20email");
  assert.equal(requireFreshExternalMcpConsent(native, firstParty), native);
  assert.equal(requireFreshExternalMcpConsent(identity, firstParty), identity);
});
test("recognizes resource-bound MCP requests even with baseline scopes", () => {
  const url = requireFreshExternalMcpConsent(authorize("client_id=external&scope=openid&resource=https%3A%2F%2Fmail.guidedstepswellness.com%2Fmcp"), firstParty);
  assert.equal(new URL(url).searchParams.get("prompt"), "consent");
});
test("never mutates OAuth continuation, token or signed queries", () => {
  for (const path of ["/api/auth/oauth2/continue", "/api/auth/oauth2/token", "/api/auth/oauth2/consent"]) {
    const url = issuer + path + "?client_id=external&scope=mail.read";
    assert.equal(requireFreshExternalMcpConsent(url, firstParty), url);
  }
});
