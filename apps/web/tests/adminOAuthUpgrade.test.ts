import assert from "node:assert/strict";
import test from "node:test";
import { adminOAuthUpgradeUrl } from "../src/adminOAuthUpgrade.js";

test("full admin review starts fresh OAuth while preserving client security bindings",()=>{
  const original=new URLSearchParams({client_id:"chatgpt",redirect_uri:"https://chatgpt.com/connector_platform_oauth_redirect",response_type:"code",scope:"openid mail.read",state:"original-client-state",code_challenge:"original-pkce",code_challenge_method:"S256",nonce:"original-nonce",sig:"old-signature",exp:"old-expiry",prompt:"select_account"});
  original.append("resource","https://api.guidedstepswellness.com/mcp");
  original.append("resource","https://second.example/mcp");
  const upgraded=new URL(adminOAuthUpgradeUrl(original.toString(),["openid","workspace.read","domain.write","workspace.read"]),"https://mail.guidedstepswellness.com");
  assert.equal(upgraded.pathname,"/api/auth/oauth2/authorize");
  for(const key of ["client_id","redirect_uri","response_type","state","code_challenge","code_challenge_method","nonce"]) assert.equal(upgraded.searchParams.get(key),original.get(key));
  assert.deepEqual(upgraded.searchParams.getAll("resource"),original.getAll("resource"));
  assert.equal(upgraded.searchParams.get("scope"),"openid workspace.read domain.write");
  assert.equal(upgraded.searchParams.get("prompt"),"consent");
  assert.equal(upgraded.searchParams.has("sig"),false);
  assert.equal(upgraded.searchParams.has("exp"),false);
  assert.equal(original.get("scope"),"openid mail.read");
});
test("scope upgrade refuses incomplete or ambiguous authorization requests",()=>{
  assert.throws(()=>adminOAuthUpgradeUrl("client_id=chatgpt",["workspace.read"]));
  const request="client_id=chatgpt&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fcallback&response_type=code&code_challenge=secure&code_challenge_method=S256";
  assert.throws(()=>adminOAuthUpgradeUrl(request+"&client_id=other",["workspace.read"]));
  assert.throws(()=>adminOAuthUpgradeUrl(request.replace("S256","plain"),["workspace.read"]));
});
