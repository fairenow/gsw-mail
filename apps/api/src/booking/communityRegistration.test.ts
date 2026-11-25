import { test } from "node:test";
import assert from "node:assert/strict";
import { communityProofSchema,verifyCommunityRegistration } from "./communityRegistration.js";
const input={linkId:"85deaa6f-1a11-4ae2-8ed5-846c351a1288",requestId:"a4b4a79e-d295-4d85-9b0f-754b1160a1c4",email:"test@example.com",proof:"1795644000000."+"A".repeat(43)};
const endpoint="https://community.example.com/gsw-mail/campaign-eligibility";
test("booking proof syntax is bounded",()=>{
 assert.equal(communityProofSchema.safeParse(input.proof).success,true);
 assert.equal(communityProofSchema.safeParse(input.proof+"x").success,false);
 assert.equal(communityProofSchema.safeParse("invalid").success,false);
});
test("verification uses fixed HTTPS Community endpoint and exact registration, link and email",async()=>{
 let called=false;
 await verifyCommunityRegistration(input,{endpoint,fetcher:async(url,options)=>{
  called=true;assert.equal(String(url),"https://community.example.com/gsw-mail/booking-validate");assert.equal(options?.redirect,"error");assert.deepEqual(JSON.parse(String(options?.body)),input);
  return Response.json({valid:true});
 }});
 assert.equal(called,true);
});
test("invalid or unavailable Community proof fails closed before reservation",async()=>{
 for(const response of [Response.json({valid:false}),Response.json({valid:"true"}),new Response("unavailable",{status:503})]){
  await assert.rejects(verifyCommunityRegistration(input,{endpoint,fetcher:async()=>response}));
 }
 await assert.rejects(verifyCommunityRegistration(input,{endpoint:"http://community.example.com/gsw-mail/campaign-eligibility",fetcher:async()=>{throw Error("must not fetch")}}),/verification unavailable/);
 await assert.rejects(verifyCommunityRegistration(input,{endpoint:"https://community.example.com/other",fetcher:async()=>{throw Error("must not fetch")}}),/verification unavailable/);
});
