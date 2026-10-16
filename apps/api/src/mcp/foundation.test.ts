import assert from "node:assert/strict";
import test from "node:test";
import { allMcpCapabilities, authorizeMcpInvocation, scopedMcpCapabilities } from "./capabilityPolicy.js";
import { escapeProposalHtml, renderProposalNotification, validateMcpProposal, PROPOSAL_NOTIFICATION_RECIPIENT } from "./proposalContract.js";

test("the MCP catalog follows the full GSW agent tool registry", () => {
  const tools = allMcpCapabilities();
  assert.ok(tools.length > 20, "expected broad tool coverage");
  assert.equal(new Set(tools.map(t => t.name)).size, tools.length, "unique external names");
  assert.ok(tools.some(t => t.risk === "read"));
  assert.ok(tools.some(t => t.risk !== "read"));
});

test("missing OAuth scopes reject a tool even with user approval", () => {
  const target = allMcpCapabilities().find(t => t.requiredScopes.length > 0);
  assert.ok(target);
  assert.deepEqual(authorizeMcpInvocation({toolName: target.name,scopes:new Set(),approved:true,allowExternal:true}),{allowed:false,reason:"insufficient_scope"});
});

test("writes require approval and external actions must be enabled", () => {
  const write = allMcpCapabilities().find(t => t.risk === "reversible_write");
  if (write) {
    const result = authorizeMcpInvocation({toolName:write.name,scopes:new Set(write.requiredScopes),approved:false,allowExternal:true});
    assert.deepEqual(result,{allowed:false,reason:"approval_required"});
  }
  const external = allMcpCapabilities().find(t => t.risk === "external");
  if (external) {
    const result = authorizeMcpInvocation({toolName:external.name,scopes:new Set(external.requiredScopes),approved:true,allowExternal:false});
    assert.deepEqual(result,{allowed:false,reason:"external_actions_disabled"});
  }
});

test("scoped catalogs remove tools without their permissions", () => {
  assert.ok(scopedMcpCapabilities(new Set()).every(t => t.requiredScopes.length === 0));
});

test("proposal validation rejects unbounded content and bad types", () => {
  const valid = validateMcpProposal({kind:"bug",priority:"normal",title:"Failed send",summary:"A send was not delivered"});
  assert.equal(valid.title,"Failed send");
  assert.throws(() => validateMcpProposal({kind:"unknown",priority:"normal",title:"x",summary:"y"}));
  assert.throws(() => validateMcpProposal({kind:"bug",priority:"normal",title:"x",summary:"a".repeat(10001)}));
});

test("notification renders untrusted text as escaped HTML", () => {
  const proposal = { ...validateMcpProposal({kind:"security",priority:"high",title:"<script>alert(1)</script>",summary:"Check & verify"}),sourceClient:"Claude",requesterUserId:"test" };
  const rendered = renderProposalNotification(proposal);
  assert.ok(rendered.html.includes("&lt;script&gt;"));
  assert.ok(!rendered.html.includes("<script>"));
  assert.equal(escapeProposalHtml("a&b"),"a&amp;b");
  assert.equal(PROPOSAL_NOTIFICATION_RECIPIENT,"ramon@team.guidedstepswellness.com");
});
