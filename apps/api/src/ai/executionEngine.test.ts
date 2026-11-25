import {test} from "node:test";import assert from "node:assert/strict";
import {executeAiTurn} from "./executionEngine.js";
import type {AiProvider,AiProviderMessage,AiProviderRunResult} from "./providers/types.js";
const tool={type:"function" as const,function:{name:"mail__read",description:"read",parameters:{type:"object"}}};
const call=(id:string,name="mail__read")=>({id,type:"function" as const,function:{name,arguments:"{}"}});
const answer:AiProviderRunResult={content:"done",toolCalls:[],model:"test"};
const requests=(...calls:ReturnType<typeof call>[]):AiProviderRunResult=>({content:null,toolCalls:calls,model:"test"});
function provider(results:AiProviderRunResult[]):AiProvider{return {id:"kimi",async run(){const next=results.shift();if(!next)throw Error("extra round");return next;}};}
const prepare=async()=>({tools:[tool],context:"authorized"});
test("shared engine pairs each tool result and returns final answer",async()=>{
 const messages:AiProviderMessage[]=[];let count=0;
 const result=await executeAiTurn({provider:provider([requests(call("a")),answer]),messages,maxToolRounds:2,maxCallsPerRound:4,prepareRound:prepare,onTool:async({context,respond})=>{assert.equal(context,"authorized");count++;respond("verified");}});
 assert.equal(result.kind,"completed");assert.equal(count,1);assert.deepEqual(messages.map(m=>m.role),["assistant","tool"]);assert.equal(messages[1]?.content,"verified");
});
test("review stops the entire batch without executing subsequent operations",async()=>{
 let count=0;const result=await executeAiTurn({provider:provider([requests(call("a"),call("b"))]),messages:[],maxToolRounds:2,maxCallsPerRound:4,prepareRound:prepare,onTool:async()=>{count++;return {review:"required"};}});
 assert.deepEqual(result,{kind:"stopped",value:{review:"required"}});assert.equal(count,1);
});
test("unadvertised and oversized batches execute no tools and retain paired responses",async()=>{
 for(const calls of [[call("a","mail__send")],[call("a"),call("b")]]){
  const messages:AiProviderMessage[]=[];let count=0;
  await executeAiTurn({provider:provider([requests(...calls),answer]),messages,maxToolRounds:2,maxCallsPerRound:1,prepareRound:prepare,onTool:async()=>{count++;}});
  assert.equal(count,0);assert.equal(messages.filter(m=>m.role==="tool").length,calls.length);
 }
});
test("authorization is rechecked at finalization and finalization has no tools",async()=>{
 let checks=0;const p:AiProvider={id:"kimi",async run(input){if(checks===1)return requests(call("a"));assert.deepEqual(input.tools,[]);return answer;}};
 const result=await executeAiTurn({provider:p,messages:[],maxToolRounds:1,maxCallsPerRound:1,prepareRound:async()=>{checks++;return prepare();},onTool:async({respond})=>{respond("verified");},finalization:{prompt:"Summarize"}});
 assert.equal(checks,2);assert.equal(result.kind==="completed"&&result.limitReached,true);
});
test("revocation before next round or missing response stops execution",async()=>{
 await assert.rejects(executeAiTurn({provider:provider([requests(call("a"))]),messages:[],maxToolRounds:2,maxCallsPerRound:1,prepareRound:async(round)=>{if(round)throw Error("revoked");return prepare();},onTool:async({respond})=>{respond("verified");}}),/revoked/);
 await assert.rejects(executeAiTurn({provider:provider([requests(call("a"))]),messages:[],maxToolRounds:2,maxCallsPerRound:1,prepareRound:prepare,onTool:async()=>undefined}),/did not return/);
});
test("repeated tool IDs are rejected before replay",async()=>{
 let count=0;await assert.rejects(executeAiTurn({provider:provider([requests(call("a")),requests(call("a"))]),messages:[],maxToolRounds:2,maxCallsPerRound:1,prepareRound:prepare,onTool:async({respond})=>{count++;respond("ok");}}),/Repeated/);assert.equal(count,1);
});
