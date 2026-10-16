import assert from "node:assert/strict";
import test from "node:test";
import { mayInvokeSharedTool } from "./effectivePermissions.js";
import type { AgentToolDefinition } from "../ai/tools/types.js";

const tool = {name:"mail.send_draft",requiredScopes:["mail.send"],risk:"external"} as AgentToolDefinition;
test("external OAuth cannot elevate user's GSW permission",()=>{
 const auth={userId:"u",accountId:"a",grantedScopes:new Set(["mail.send"]),allowedScopes:new Set<string>(),approvedToolCalls:new Set(["c"])};
 assert.equal(mayInvokeSharedTool(tool,auth,"c").reason,"user_permission_denied");
});
test("existing GSW permission is not enough without OAuth grant",()=>{
 const auth={userId:"u",accountId:"a",grantedScopes:new Set<string>(),allowedScopes:new Set(["mail.send"]),approvedToolCalls:new Set(["c"])};
 assert.equal(mayInvokeSharedTool(tool,auth,"c").reason,"oauth_scope_missing");
});
test("writes require verified approval even with both grants",()=>{
 const auth={userId:"u",accountId:"a",grantedScopes:new Set(["mail.send"]),allowedScopes:new Set(["mail.send"]),approvedToolCalls:new Set<string>()};
 assert.equal(mayInvokeSharedTool(tool,auth,"c").reason,"approval_required");
});
