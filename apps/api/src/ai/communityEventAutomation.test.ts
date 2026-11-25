import {test} from "node:test";import assert from "node:assert/strict";
import {sealEventGrant,readCommunityEventSnapshot} from "./communityEventAutomation.js";
test("event automation capability is encrypted and pinned to the reviewed event and mailbox",async()=>{
 const old=process.env.GSW_COMMUNITY_REVIEW_KEY;process.env.GSW_COMMUNITY_REVIEW_KEY="ab".repeat(32);
 try{
  const eventId="eventexample001",accountId="85deaa6f-1a11-4ae2-8ed5-846c351a1288",token="A".repeat(43);
  const grant=sealEventGrant({eventId,accountId,token,approvalId:"a4b4a79e-d295-4d85-9b0f-754b1160a1c4",digest:"c".repeat(64)});
  assert.equal(JSON.stringify(grant).includes(token),false);
  const endpoint="https://community.example.com/gsw-mail/campaign-eligibility";
  const snapshot={event:{id:eventId,title:"Event",startTime:1,endTime:2,status:"published",capacity:null},registrations:{counts:{confirmed:3},truncated:false,sampleSize:3},appointments:{counts:{confirmed:2},truncated:false},volunteers:null,sponsors:null,asOf:3,addressesWithheld:true};
  const fetched=await readCommunityEventSnapshot(grant,accountId,{endpoint,fetcher:async(url,opts)=>{assert.equal(String(url),"https://community.example.com/gsw-mail/event-automation-snapshot");assert.equal(opts?.redirect,"error");assert.equal(new Headers(opts?.headers).get("authorization"),"Bearer "+token);assert.deepEqual(JSON.parse(String(opts?.body)),{eventId,accountId});return Response.json(snapshot);}});
  assert.deepEqual(fetched,snapshot);
  await assert.rejects(readCommunityEventSnapshot(grant,"a4b4a79e-d295-4d85-9b0f-754b1160a1c4",{endpoint,fetcher:async()=>{throw Error("must not fetch");}}),/mismatch/);
  await assert.rejects(readCommunityEventSnapshot({...grant,eventId:"another-event"},accountId,{endpoint,fetcher:async()=>{throw Error("must not fetch");}}),/mismatch/);
  await assert.rejects(readCommunityEventSnapshot(grant,accountId,{endpoint,fetcher:async()=>new Response("",{status:403})}),/revoked/);
  await assert.rejects(readCommunityEventSnapshot(grant,accountId,{endpoint,fetcher:async()=>Response.json({...snapshot,emails:["private@example.com"]})}));
 }finally{if(old===undefined)delete process.env.GSW_COMMUNITY_REVIEW_KEY;else process.env.GSW_COMMUNITY_REVIEW_KEY=old;}
});
