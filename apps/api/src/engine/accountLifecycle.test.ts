import assert from "node:assert/strict";
import test from "node:test";
import { destroyMailboxAccount } from "./accountLifecycle.js";

test("mailbox deletion verifies local part AND domain AND user type before destruction", async () => {
  const calls: any[] = [];
  const call = async (input: any[]) => {
    calls.push(input[0]);
    const method = input[0][0];
    const result = method === "x:Domain/query" ? {ids:["domain"]} : method === "x:Domain/get" ? {list:[{id:"domain",name:"example.com"}]} : method === "x:Account/query" ? {ids:["right","wrong"]} : method === "x:Account/get" ? {list:[{id:"right",name:"alice",domainId:"domain","@type":"User"},{id:"wrong",name:"alice",domainId:"different","@type":"User"}]} : {destroyed:["right"]};
    return [[method, result]];
  };
  await destroyMailboxAccount("alice@example.com", "stale-id", call);
  assert.deepEqual(calls.at(-1)[1], {destroy:["right"]});
  assert.deepEqual(calls[2][1].filter, {name:"alice",domainId:"domain"});
});

test("ambiguous server identities fail without a delete call", async () => {
  let deleted = false;
  await assert.rejects(destroyMailboxAccount("alice@example.com",null,async calls => {
    const method = (calls[0] as any)[0];
    if (method === "x:Account/set") deleted = true;
    const result = method === "x:Domain/query" ? {ids:["domain"]} : method === "x:Domain/get" ? {list:[{id:"domain",name:"example.com"}]} : method === "x:Account/query" ? {ids:["bad"]} : {list:[{id:"bad",name:"alice",domainId:"different","@type":"User"}]};
    return [[method,result]];
  }), /could not be verified/);
  assert.equal(deleted,false);
});
