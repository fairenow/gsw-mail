import test from "node:test";
import assert from "node:assert/strict";
import {PGlite} from "@electric-sql/pglite";
import {pool} from "../db/client.js";
import {HOST_CODE_SCHEMA,createOwnerCode} from "../meetings/ownerCode.js";
import {redeemNativeOwnerCode} from "../meetings/nativeOwnerCode.js";

test("native organizer redemption is retryable without reusing code on another device",async()=>{
 const db=new PGlite(),oldQuery=pool.query,oldConnect=pool.connect;
 const keys=["GSW_MEETINGS_SIGNING_SECRET","GSW_MEETINGS_API_URL","GSW_MEETINGS_WEB_ORIGIN"] as const;
 const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 process.env.GSW_MEETINGS_SIGNING_SECRET="test-only-signing-secret-at-least-32-bytes";
 process.env.GSW_MEETINGS_API_URL="https://meet-api.example.test";
 process.env.GSW_MEETINGS_WEB_ORIGIN="https://meet.example.test";
 const query=(sql:string,params?:unknown[])=>db.query(sql,params);
 pool.query=query as unknown as typeof pool.query;
 pool.connect=(async()=>({query,release(){}})) as unknown as typeof pool.connect;
 const account="00000000-0000-4000-8000-000000000001",requestId="00000000-0000-4000-8000-000000000002";
 let grants=0,exchanges=0;
 const dependencies={
  authorize:async()=>({userId:"owner",workspaceId:"workspace",videoMeetings:true}),
  issueHost:async()=>{grants++;return {ticket:"a".repeat(64)};},
  transport:(async()=>{exchanges++;return Response.json({meetingId:"meeting",sessionToken:"b".repeat(64),expiresAt:Date.now()+3600000});}) as typeof fetch,
 };
 try{
  await db.exec("CREATE TABLE users(id text PRIMARY KEY);CREATE TABLE email_accounts(id uuid PRIMARY KEY);INSERT INTO users VALUES('owner');INSERT INTO email_accounts VALUES('"+account+"');");
  await db.exec(HOST_CODE_SCHEMA);
  const {ownerCode}=await createOwnerCode("meeting",account,"owner",new Date().toISOString());
  await assert.rejects(redeemNativeOwnerCode("meeting",ownerCode,requestId,{...dependencies,transport:(async()=>{throw Error("network interrupted");}) as typeof fetch}));
  const before=(await db.query<{consumed_at:Date|null;attempts:number}>("SELECT consumed_at,attempts FROM meeting_owner_codes")).rows[0]!;
  assert.equal(before.consumed_at,null);assert.equal(before.attempts,0);
  const first=await redeemNativeOwnerCode("meeting",ownerCode,requestId,dependencies);
  assert.equal(first?.sessionToken,"b".repeat(64));assert.equal(first?.apiOrigin,"https://meet-api.example.test");
  const replay=await redeemNativeOwnerCode("meeting",ownerCode,requestId,dependencies);
  assert.deepEqual(replay,first);assert.equal(exchanges,1);assert.equal(grants,2);
  assert.equal(await redeemNativeOwnerCode("meeting",ownerCode,"00000000-0000-4000-8000-000000000003",dependencies),null);
  const encrypted=(await db.query<{native_session:string}>("SELECT native_session FROM meeting_owner_codes")).rows[0]!.native_session;
  assert.ok(!encrypted.includes("b".repeat(64)));
  await db.exec("UPDATE meeting_owner_codes SET native_session='tampered'");
  await assert.rejects(redeemNativeOwnerCode("meeting",ownerCode,requestId,dependencies));
 }finally{
  pool.query=oldQuery;pool.connect=oldConnect;
  for(const key of keys){const value=previous[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}
  await db.close();
 }
});
