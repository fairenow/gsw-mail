import assert from "node:assert/strict";
import test from "node:test";
import { adminMailboxWriteGate } from "./adminMailboxWritePolicy.js";
import { mcpWriteCallPolicy } from "./writeTestPolicy.js";

test("admin mailbox writes are disabled by default", () => {
  assert.deepEqual(adminMailboxWriteGate({enabled:undefined,persistedApprovalRequired:undefined,hasWriteScope:true}),{allowed:false,reason:"admin_writes_disabled"});
  assert.deepEqual(adminMailboxWriteGate({enabled:"false",persistedApprovalRequired:undefined,hasWriteScope:true}),{allowed:false,reason:"admin_writes_disabled"});
});
test("OAuth scope required even with admin write opt-in", () => {
  assert.deepEqual(adminMailboxWriteGate({enabled:"true",persistedApprovalRequired:undefined,hasWriteScope:false}),{allowed:false,reason:"oauth_scope_missing"});
});
test("unimplemented persisted approval requirement fails closed", () => {
  assert.deepEqual(adminMailboxWriteGate({enabled:"true",persistedApprovalRequired:"true",hasWriteScope:true}),{allowed:false,reason:"workspace_approval_not_supported"});
  assert.deepEqual(adminMailboxWriteGate({enabled:"true",persistedApprovalRequired:undefined,hasWriteScope:true}),{allowed:true});
});
test("workspace mailbox creation requires explicit confirmation and UUID request", () => {
  const params={risk:"external" as const,requiredScopes:["mailbox_admin.write"],userId:"user-1",clientId:"client-1",accountId:"workspace-1",toolName:"create_admin_mailbox",argumentsValue:{organizationId:"workspace-1",domainId:"domain-1",localPart:"ramon"}};
  assert.deepEqual(mcpWriteCallPolicy({...params,requestId:"c1111111-1111-4111-8111-111111111111",confirmExternal:false}),{allowed:false,reason:"explicit_external_confirmation_required"});
  assert.deepEqual(mcpWriteCallPolicy({...params,requestId:"not-a-uuid",confirmExternal:true}),{allowed:false,reason:"request_id_uuid_required"});
  const a=mcpWriteCallPolicy({...params,requestId:"c1111111-1111-4111-8111-111111111111",confirmExternal:true});
  const replay=mcpWriteCallPolicy({...params,requestId:"c1111111-1111-4111-8111-111111111111",confirmExternal:true});
  const change=mcpWriteCallPolicy({...params,requestId:"c1111111-1111-4111-8111-111111111111",confirmExternal:true,argumentsValue:{...params.argumentsValue,domainId:"domain-2"}});
  assert.ok(a.allowed && replay.allowed && change.allowed);
  if(a.allowed && replay.allowed && change.allowed){
    assert.equal(a.key,replay.key);
    assert.equal(a.digest,replay.digest);
    assert.equal(a.key,change.key);
    assert.notEqual(a.digest,change.digest);
  }
});
