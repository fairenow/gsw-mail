import assert from "node:assert/strict";
import test from "node:test";
import { toolWithinBoundary, withToolBoundary } from "../ai/toolBoundary.js";
test("async nested execution cannot widen a connection's tool boundary", async () => {
  const mail = {name:"mail.read",requiredScopes:["mail.read"]};
  const admin = {name:"domain.read",requiredScopes:["domain.read"]};
  await withToolBoundary(tool => tool.requiredScopes.every(scope => scope === "mail.read"), async () => {
    await Promise.resolve();
    assert.equal(toolWithinBoundary(mail),true);
    assert.equal(toolWithinBoundary(admin),false);
    await withToolBoundary(() => true, async () => assert.equal(toolWithinBoundary(admin),false));
  });
  assert.equal(toolWithinBoundary(admin),true);
});
test("concurrent requests keep independent permission boundaries", async () => {
  await Promise.all(["mail.read","domain.read"].map(scope => withToolBoundary(tool => tool.requiredScopes.includes(scope), async () => {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(toolWithinBoundary({name:"test",requiredScopes:[scope]}),true);
    assert.equal(toolWithinBoundary({name:"test",requiredScopes:[scope === "mail.read" ? "domain.read" : "mail.read"]}),false);
  })));
});

test("registry discovery and execution both enforce the inherited boundary", async () => {
  const { AgentToolRegistry } = await import("../ai/tools/registry.js");
  let executions = 0;
  const tools = ["mail.read","domain.read"].map(scope => ({name:scope,description:scope,inputSchema:{type:"object"},requiredScopes:[scope],risk:"read" as const,execute:async () => {executions++;return {ok:true,toolCallId:"test",data:{},audit:{userId:"u",accountId:"a",startedAt:"",completedAt:""}};}}));
  const registry = new AgentToolRegistry(tools);
  await withToolBoundary(tool => tool.requiredScopes.includes("mail.read"), async () => {
    assert.deepEqual(registry.definitions().map(tool => tool.name),["mail.read"]);
    assert.deepEqual(registry.providerDefinitions().map(tool => tool.function.name),["mail__read"]);
    const result = await registry.execute("domain__read","{}",{userId:"u",authUserId:"auth",accountId:"a",headers:{}},"test");
    assert.equal(result.ok,false);
    assert.equal(executions,0);
  });
});
