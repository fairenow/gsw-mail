import { test } from "node:test";
import assert from "node:assert/strict";
import { communityAiClientAllowed, communityAiToolAllowed, communityAiProposalAllowed, communityAiActionAllowed, parseCommunityActionArguments } from "./communityAiPolicy.js";
test("delegated AI requires the configured client and separate inference scope",()=>{
  assert.equal(communityAiClientAllowed("community",new Set(["ai.infer"]),"community"),true);
  assert.equal(communityAiClientAllowed("other",new Set(["ai.infer"]),"community"),false);
  assert.equal(communityAiClientAllowed("community",new Set(["mail.read"]),"community"),false);
  assert.equal(communityAiClientAllowed("community",new Set(["ai.infer"]),undefined),false);
});
test("AI cannot send or mutate, even with broad OAuth scopes",()=>{
  const scopes=new Set(["mail.read","mail.write","mail.send","ai.infer"]);
  assert.equal(communityAiToolAllowed({name:"mail.read",requiredScopes:["mail.read"],risk:"read"},scopes),true);
  assert.equal(communityAiToolAllowed({name:"mail.send_draft",requiredScopes:["mail.send"],risk:"external"},scopes),false);
  assert.equal(communityAiToolAllowed({name:"mail.create_draft",requiredScopes:["mail.write"],risk:"reversible_write"},scopes),false);
  assert.equal(communityAiToolAllowed({name:"mail.read",requiredScopes:["mail.read"],risk:"reversible_write"},scopes),false);
  assert.equal(communityAiToolAllowed({name:"mail.read",requiredScopes:["mail.read"]},new Set(["ai.infer"])),false);
});

test("native draft creation may be proposed, but sending cannot",()=>{const scopes=new Set(["mail.write","mail.send"]);assert.equal(communityAiProposalAllowed({name:"mail.create_draft",requiredScopes:["mail.write"],risk:"reversible_write"},scopes),true);assert.equal(communityAiProposalAllowed({name:"mail.send_draft",requiredScopes:["mail.send"],risk:"external"},scopes),false);});

test("reviewed write parity remains scoped and excludes sending, administration and background grants",()=>{
 const scopes=new Set(["mail.write","mail.send","contacts.write","calendar.read","files.write","campaign.send","automations.write"]);
 assert.equal(communityAiActionAllowed({name:"mail.update_draft",requiredScopes:["mail.write"],risk:"reversible_write"},scopes),true);
 assert.equal(communityAiActionAllowed({name:"contacts.create",requiredScopes:["contacts.write"],risk:"reversible_write"},scopes),true);
 assert.equal(communityAiActionAllowed({name:"files.create_text",requiredScopes:["files.write"],risk:"reversible_write"},new Set()),false);
 for(const name of ["mail.send_draft","campaign.launch","automations.approve_sending","automations.create","mailbox_admin.create"]){
  assert.equal(communityAiActionAllowed({name,requiredScopes:[],risk:"external"},scopes),false);
  assert.equal(communityAiActionAllowed({name,requiredScopes:[],risk:"reversible_write"},scopes),false);
 }
 assert.equal(communityAiToolAllowed({name:"calendar.events.list",requiredScopes:["calendar.read"],risk:"read"},scopes),true);
 assert.equal(communityAiToolAllowed({name:"calendar.events.list",requiredScopes:["calendar.read"],risk:"read"},new Set()),false);
 assert.deepEqual(parseCommunityActionArguments('{"name":"Test"}'),{name:"Test"});
 assert.equal(parseCommunityActionArguments("[]"),null);
 assert.equal(parseCommunityActionArguments("{"),null);
});

test("calendar writes require calendar.write consent and exact reviewed execution",()=>{
 const event={name:"calendar.events.create",requiredScopes:["calendar.write"],risk:"external"};
 assert.equal(communityAiActionAllowed(event,new Set(["calendar.read"])),false);
 assert.equal(communityAiActionAllowed(event,new Set(["calendar.write"])),true);
 assert.equal(communityAiToolAllowed(event,new Set(["calendar.write"])),false);
 assert.equal(communityAiActionAllowed({...event,requiredScopes:[]},new Set(["calendar.write"])),false);
});

import { communityBridgeTools,communityBridgeNames,campaignPlanTool,callCommunityBridge } from "./communityBridge.js";
test("Community bridge exposes only known read capabilities, not arbitrary remote execution",async()=>{
 assert.equal(communityBridgeNames.size,5);
 assert.equal(communityBridgeNames.has("community.admin.me"),true);
 assert.equal(communityBridgeNames.has("community.events.read"),true);
 assert.equal(communityBridgeNames.has("community.campaign.prepare"),false);
 assert.equal(communityBridgeNames.has("community.events.delete"),false);
 assert.ok(communityBridgeTools.every(t=>t.function.name.startsWith("community__")));
 assert.equal(campaignPlanTool.function.name,"community__campaign__prepare");
 await assert.rejects(callCommunityBridge("untrusted","account","community.events.delete","{}"),/Unsupported Community tool/);
});

import { classifyAiEntitlement } from "../billing/aiAccess.js";
test("AI subscription status recognizes founder exemptions without Stripe subscriptions",()=>{
 assert.equal(classifyAiEntitlement(true,[]).source,"founder_exemption");
 assert.equal(classifyAiEntitlement(true,[]).allowed,true);
 assert.equal(classifyAiEntitlement(false,[]).allowed,false);
 const active={status:"active",ai_quantity:1,current_period_end:new Date("2027-01-01T00:00:00Z"),current:true};
 assert.equal(classifyAiEntitlement(false,[active]).source,"subscription");
 assert.equal(classifyAiEntitlement(false,[{...active,current:false}]).allowed,false);
 assert.equal(classifyAiEntitlement(false,[{...active,status:"past_due"}]).allowed,false);
 assert.equal(classifyAiEntitlement(false,[{...active,ai_quantity:0}]).allowed,false);
});
