import assert from "node:assert/strict";
import test from "node:test";
import { consentPermitsMcpToken } from "./consentPolicy.js";

test("OAuth consent permits precisely the authorized scopes",()=>{
  assert.equal(consentPermitsMcpToken({tokenScopes:new Set(["openid","mail.read"]),consentScopes:["openid","mail.read"],clientDisabled:false}),true);
});
test("disconnect immediately disallows issued bearer tokens",()=>{
  assert.equal(consentPermitsMcpToken({tokenScopes:new Set(["openid","mail.read"]),consentScopes:null,clientDisabled:false}),false);
});
test("client disabled prevents use regardless of previously granted scopes",()=>{
  assert.equal(consentPermitsMcpToken({tokenScopes:new Set(["mail.read"]),consentScopes:["mail.read"],clientDisabled:true}),false);
});
test("scope downgrade invalidates elevated token",()=>{
  assert.equal(consentPermitsMcpToken({tokenScopes:new Set(["openid","mail.send"]),consentScopes:["openid","mail.read"],clientDisabled:false}),false);
});
