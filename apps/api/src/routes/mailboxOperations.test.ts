import assert from "node:assert/strict";
import test from "node:test";
import { createMailboxOperations, mailboxOperationAllowed } from "../integrations/operations.js";
import { AgentToolRegistry } from "../ai/tools/registry.js";
import type { AgentToolDefinition } from "../ai/tools/types.js";

test("mailbox operations use fixed identity, exclude admin capabilities, and deduplicate writes", async () => {
  let writes = 0, adminCalls = 0, active = true;
  const audit = { userId: "owner", accountId: "mailbox", startedAt: "now", completedAt: "now" };
  const tools: AgentToolDefinition[] = [
    { name: "mail.read", requiredScopes: ["mail.read"], risk: "read", description: "Read", inputSchema: {}, execute: async ctx => { assert.equal(ctx.accountId,"mailbox"); assert.equal(ctx.userId,"owner"); return {ok:true,toolCallId:"r",data:{id:"message"},audit}; } },
    { name: "mail.send", requiredScopes: ["mail.send"], risk: "external", description: "Send", inputSchema: {}, execute: async () => { writes++; return {ok:true,toolCallId:"w",data:{sendId:"send-1",textBody:"private"},audit}; } },
    { name: "admin.delete", requiredScopes: ["workspace.admin"], risk: "external", description: "Admin", inputSchema: {}, execute: async () => { adminCalls++; return {ok:true,toolCallId:"a",audit}; } },
  ];
  const registry = new AgentToolRegistry(tools);
  tools.push({ name:"workers.delegate",requiredScopes:[],risk:"read",description:"Delegate",inputSchema:{},execute: async ctx => registry.execute("admin.delete","{}",ctx,"nested") });
  const nestedRegistry = new AgentToolRegistry(tools);
  const rows = new Map<string, {key:string;status:string;result:Record<string,unknown>}>();
  const service = {
    validateKey: async () => { if(!active) throw new Error("revoked"); },
    installation: async () => ({installation:{testMode:false},account:{id:"mailbox"}}),
    context: async () => ({userId:"owner",authUserId:"mailbox-auth",accountId:"mailbox",headers:{}}),
  };
  const ops = createMailboxOperations({registry:nestedRegistry,service,
    reserve:async (input: {key:string;fingerprint:string}) => { const existing=rows.get(input.key);if(existing)return {reservation:existing,reused:true};const row={key:input.key,status:"reserved",result:{fingerprint:input.fingerprint}};rows.set(input.key,row);return {reservation:row,reused:false}; },
    complete:async (key:string,result:Record<string,unknown>) => { rows.set(key,{key,status:"completed",result}); },
  } as unknown as Parameters<typeof createMailboxOperations>[0]);
  const principal = {installationId:"installation",keyId:"key",scopes:["mailbox.full"]};
  assert.ok(!ops.capabilities().some(tool=>tool.name==="admin.delete"));
  assert.equal(mailboxOperationAllowed({name:"domain.read",requiredScopes:["domain.read"]}),false);
  await assert.rejects(ops.execute(principal,{name:"admin.delete",arguments:{}},"admin"),/operation_not_allowed/);
  await assert.rejects(ops.execute(principal,{name:"mail.read",arguments:{accountId:"other"}}),/context_override_not_allowed/);
  await assert.rejects(ops.execute(principal,{name:"workers.delegate",arguments:{worker:"admin"}}),/context_override_not_allowed/);
  await ops.execute(principal,{name:"mail.read",arguments:{}});
  await assert.rejects(ops.execute(principal,{name:"mail.send",arguments:{}}),/idempotency_key_required/);
  await ops.execute(principal,{name:"mail.send",arguments:{to:"recipient"}},"stable-key");
  const replay = await ops.execute(principal,{name:"mail.send",arguments:{to:"recipient"}},"stable-key");
  assert.equal("replayed" in replay && replay.replayed,true);
  assert.equal(writes,1);
  assert.ok(!JSON.stringify([...rows.values()]).includes("private"));
  await assert.rejects(ops.execute(principal,{name:"mail.send",arguments:{to:"different"}},"stable-key"),/idempotency_conflict/);
  const nested = await ops.execute(principal,{name:"workers.delegate",arguments:{worker:"mail"}});
  assert.equal("ok" in nested && nested.ok,false);
  assert.equal(adminCalls,0);
  active=false;
  await assert.rejects(ops.execute(principal,{name:"mail.send",arguments:{}},"later"),/revoked/);
});
