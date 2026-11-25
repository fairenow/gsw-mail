import { test } from "node:test";
import assert from "node:assert/strict";
import { communityAiClientAllowed, communityAiToolAllowed, communityAiProposalAllowed } from "./communityAiPolicy.js";
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
