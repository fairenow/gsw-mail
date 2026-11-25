import test from "node:test";
import assert from "node:assert/strict";
import { communitySnapshotDigest,communityRecipientEligible } from "./communityCampaignPolicy.js";
test("community campaign snapshot binds every recipient and opt-out token",()=>{
 const a={email:"a@example.com",displayName:"A",firstName:"A",communityUnsubscribeToken:"token-a"};
 const b={...a,email:"b@example.com"};
 assert.equal(communitySnapshotDigest("x","y","z",[a,b]),communitySnapshotDigest("x","y","z",[b,a]));
 assert.notEqual(communitySnapshotDigest("x","y","z",[a]),communitySnapshotDigest("x","y","z",[{...a,communityUnsubscribeToken:"token-b"}]));
});
test("missing opt-out token fails closed",async()=>assert.equal(await communityRecipientEligible({email:"a@example.com",displayName:"A",communityUnsubscribeToken:null}),false));
